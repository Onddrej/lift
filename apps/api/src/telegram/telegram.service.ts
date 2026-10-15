/**
 * The Lift Telegram bot: one bot for every user, run inside the API.
 *
 * Three jobs, all here because they share one client and one table:
 *
 * - **Linking.** The app asks for a link, gets a `t.me/<bot>?start=<code>` URL,
 *   and the code coming back through `/start` ties the chat to the account.
 *   The code is single-use and short-lived; the chat id is never typed by
 *   anyone.
 * - **Talking.** Long polling, so the only thing a deployment needs is the
 *   token: no public webhook URL, no certificate, no route to register. Every
 *   answer is worked out from the synced log. There is no model behind it.
 * - **Sending on a clock.** A tick every minute sends the daily line at each
 *   user's chosen local time, and on Mondays the week's PDF with it.
 *
 * Off entirely when `TELEGRAM_BOT_TOKEN` is unset, which is every deployment
 * that has not asked for it: the endpoints then report the bot as unavailable
 * and the app hides the feature.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { computeWeekStreak } from '@lift/shared';
import {
  buildTrainingReport,
  dayKey,
  lastDaysWindow,
  lineForDay,
  renderReportPdf,
  reportTitle,
  startOfDayIn,
  type ReportFonts,
  type ReportWorkoutRow,
} from '@lift/shared/report';
import { Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, gt, isNotNull, ne } from 'drizzle-orm';

import { db, schema } from '../db/client.js';

import { escapeHtml, TelegramClient, TelegramError, type TelegramUpdate } from './telegram.client.js';
import { firstName, latestBodyweightKg, loadWorkouts, nextRoutineName } from './telegram.data.js';
import { dailyMessage, HELP, NOT_LINKED, reportSummary, streakMessage, welcome } from './telegram.messages.js';

const { telegramLinks } = schema;
type LinkRow = typeof telegramLinks.$inferSelect;

export interface TelegramSettings {
  timeZone: string;
  unit: 'kg' | 'lb';
  dailyTime: string;
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
}

export interface TelegramStatus {
  available: boolean;
  botUsername: string | null;
  linked: boolean;
  username: string | null;
  settings: TelegramSettings | null;
}

const LINK_TTL_MS = 15 * 60 * 1000;
const TICK_MS = 60 * 1000;
/**
 * How late a scheduled message may still go out.
 *
 * Long enough to cover a redeploy or a restart at the wrong minute, short
 * enough that moving the time from 20:00 to 08:00 at lunchtime does not send
 * this morning's message the moment the setting is saved.
 */
const SEND_WINDOW_MIN = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Telegram');
  private client: TelegramClient | null = null;
  private botUsername: string | null = null;
  private readonly stop = new AbortController();
  private timer: NodeJS.Timeout | null = null;
  private fonts: ReportFonts | null = null;
  private ticking = false;

  onModuleInit(): void {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) {
      this.logger.log('TELEGRAM_BOT_TOKEN is not set; the bot is off.');
      return;
    }
    this.client = new TelegramClient(token);
    void this.start();
  }

  onModuleDestroy(): void {
    this.stop.abort();
    if (this.timer) clearInterval(this.timer);
  }

  private async start(): Promise<void> {
    const client = this.client!;
    for (;;) {
      try {
        const me = await client.getMe();
        this.botUsername = me.username ?? null;
        // Polling and a webhook cannot both be active. Clearing it here means a
        // bot token once used elsewhere with a webhook still works.
        await client.deleteWebhook();
        break;
      } catch (cause) {
        this.logger.error(`Could not reach Telegram: ${message(cause)}. Retrying in a minute.`);
        await sleep(60_000, this.stop.signal);
        if (this.stop.signal.aborted) return;
      }
    }

    this.logger.log(`Bot @${this.botUsername} is up.`);
    void this.poll();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  // -------------------------------------------------------------------------
  // For the app
  // -------------------------------------------------------------------------

  async status(userId: string): Promise<TelegramStatus> {
    const row = await this.row(userId);
    return {
      available: this.client !== null && this.botUsername !== null,
      botUsername: this.botUsername,
      linked: !!row?.chatId,
      username: row?.username ?? null,
      settings: row ? settingsOf(row) : null,
    };
  }

  /** Stores the settings and returns the one-time link that finishes connecting in Telegram. */
  async connect(userId: string, settings: TelegramSettings): Promise<{ url: string }> {
    if (!this.client || !this.botUsername) throw new ServiceUnavailableException('The Telegram bot is not set up on this server.');

    const code = randomBytes(18).toString('base64url');
    const values = { ...settings, linkCode: code, linkCodeExpiresAt: new Date(Date.now() + LINK_TTL_MS), updatedAt: new Date() };
    await db
      .insert(telegramLinks)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: telegramLinks.userId, set: values });

    return { url: `https://t.me/${this.botUsername}?start=${code}` };
  }

  async update(userId: string, settings: Partial<TelegramSettings>): Promise<TelegramStatus> {
    await db
      .update(telegramLinks)
      .set({ ...settings, updatedAt: new Date() })
      .where(eq(telegramLinks.userId, userId));
    return this.status(userId);
  }

  async disconnect(userId: string): Promise<void> {
    const row = await this.row(userId);
    await db.delete(telegramLinks).where(eq(telegramLinks.userId, userId));
    if (row?.chatId && this.client) {
      await this.client.sendMessage(row.chatId, 'Disconnected from Lift. Connect again any time from the app.', false).catch(() => {});
    }
  }

  /** "Send a test": today's message, or the report, right now and outside the schedule. */
  async test(userId: string, kind: 'daily' | 'report'): Promise<void> {
    const row = await this.row(userId);
    if (!row?.chatId) throw new ServiceUnavailableException('Telegram is not connected.');
    if (kind === 'report') await this.sendReport(row, 7);
    else await this.sendDaily(row);
  }

  // -------------------------------------------------------------------------
  // Incoming
  // -------------------------------------------------------------------------

  private async poll(): Promise<void> {
    const client = this.client!;
    let offset = 0;

    while (!this.stop.signal.aborted) {
      try {
        const updates = await client.getUpdates(offset, 50, this.stop.signal);
        for (const update of updates) {
          offset = update.update_id + 1;
          await this.handle(update).catch((cause) => this.logger.error(`Update ${update.update_id}: ${message(cause)}`));
        }
      } catch (cause) {
        if (this.stop.signal.aborted) return;
        // 409 is another process polling the same token: a second replica, or
        // the old container during a rollout. Back off rather than fight it.
        const conflict = cause instanceof TelegramError && cause.status === 409;
        this.logger.warn(`Polling failed: ${message(cause)}`);
        await sleep(conflict ? 30_000 : 5_000, this.stop.signal);
      }
    }
  }

  private async handle(update: TelegramUpdate): Promise<void> {
    const chat = update.message?.chat;
    const text = update.message?.text?.trim();
    if (!chat || !text || chat.type !== 'private') return;
    const chatId = String(chat.id);
    const client = this.client!;

    const [command, ...args] = text.split(/\s+/);
    const name = command!.toLowerCase().replace(/@.*$/, '');

    if (name === '/start') {
      const code = args[0];
      if (code) await this.link(chatId, code, update.message?.from?.username ?? null);
      else {
        const row = await this.rowByChat(chatId);
        await client.sendMessage(chatId, row ? HELP : NOT_LINKED, !!row);
      }
      return;
    }

    const row = await this.rowByChat(chatId);
    if (!row) {
      await client.sendMessage(chatId, NOT_LINKED, false);
      return;
    }

    switch (intentOf(name, text)) {
      case 'week':
        await client.sendChatAction(chatId, 'typing');
        await client.sendMessage(chatId, reportSummary(await this.report(row, 7), 'Last 7 days'));
        return;
      case 'report':
        await this.sendReport(row, /month|30/i.test(text) ? 30 : 7);
        return;
      case 'streak': {
        const workouts = await loadWorkouts(row.userId, Date.now());
        await client.sendMessage(chatId, streakMessage(computeWeekStreak(workouts.map((workout) => new Date(workout.startedAt)))));
        return;
      }
      case 'quote':
        await client.sendMessage(chatId, `<i>“${lineForDay(dayKey(Date.now(), row.timeZone))}”</i>`);
        return;
      case 'pause':
        await this.update(row.userId, { dailyEnabled: false });
        await client.sendMessage(chatId, 'Daily messages paused. The Monday report still comes. /resume to bring them back.');
        return;
      case 'resume':
        await this.update(row.userId, { dailyEnabled: true });
        await client.sendMessage(chatId, `Daily messages back on, every day at ${row.dailyTime}.`);
        return;
      case 'today':
        await this.sendDaily(row);
        return;
      case 'hello': {
        const name = await firstName(row.userId);
        await client.sendMessage(chatId, `Hey${name ? `, ${escapeHtml(name)}` : ''}! Ask for <b>this week</b>, a <b>report</b>, your <b>streak</b>, or a bit of <b>motivation</b>.`);
        return;
      }
      default:
        await client.sendMessage(chatId, HELP);
    }
  }

  private async link(chatId: string, code: string, username: string | null): Promise<void> {
    const client = this.client!;
    const [row] = await db
      .select()
      .from(telegramLinks)
      .where(and(eq(telegramLinks.linkCode, code), gt(telegramLinks.linkCodeExpiresAt, new Date())))
      .limit(1);

    if (!row) {
      await client.sendMessage(chatId, 'That link has expired. Tap <b>Connect</b> in the app again for a fresh one.', false);
      return;
    }

    // One chat, one account: a chat moving to a new account leaves the old one.
    await db.update(telegramLinks).set({ chatId: null }).where(and(eq(telegramLinks.chatId, chatId), ne(telegramLinks.userId, row.userId)));

    const today = dayKey(Date.now(), row.timeZone);
    await db
      .update(telegramLinks)
      .set({
        chatId,
        username,
        linkCode: null,
        linkCodeExpiresAt: null,
        // Today's line goes out below, with the welcome. Marking it sent stops
        // the next tick sending it again a minute later.
        lastDailyOn: today,
        lastWeeklyOn: today,
        updatedAt: new Date(),
      })
      .where(eq(telegramLinks.userId, row.userId));

    const linked = { ...row, chatId, username };
    await client.sendMessage(chatId, welcome(await firstName(row.userId), row.dailyTime));
    await this.sendDaily(linked);
  }

  // -------------------------------------------------------------------------
  // Outgoing, on the clock
  // -------------------------------------------------------------------------

  private async tick(): Promise<void> {
    if (this.ticking || !this.client) return;
    this.ticking = true;
    try {
      const rows = await db.select().from(telegramLinks).where(isNotNull(telegramLinks.chatId));
      const now = Date.now();

      for (const row of rows) {
        const local = localClock(now, row.timeZone);
        const late = local.minutes - clockMinutes(row.dailyTime);
        if (late < 0 || late > SEND_WINDOW_MIN) continue;

        try {
          if (row.dailyEnabled && row.lastDailyOn !== local.day) {
            // Marked before sending: a failed send is a missed message, a
            // double send is an annoyed user, and only one of those is
            // recoverable by tomorrow.
            await db.update(telegramLinks).set({ lastDailyOn: local.day }).where(eq(telegramLinks.userId, row.userId));
            await this.sendDaily(row);
          }
          if (row.weeklyEnabled && local.weekday === 'Mon' && row.lastWeeklyOn !== local.day) {
            await db.update(telegramLinks).set({ lastWeeklyOn: local.day }).where(eq(telegramLinks.userId, row.userId));
            await this.sendReport(row, 7);
          }
        } catch (cause) {
          await this.failed(row, cause);
        }
      }
    } catch (cause) {
      this.logger.error(`Tick failed: ${message(cause)}`);
    } finally {
      this.ticking = false;
    }
  }

  /** A user who blocked the bot is unlinked, so the tick stops knocking. */
  private async failed(row: LinkRow, cause: unknown): Promise<void> {
    if (cause instanceof TelegramError && cause.status === 403) {
      await db.update(telegramLinks).set({ chatId: null }).where(eq(telegramLinks.userId, row.userId));
      this.logger.log(`User ${row.userId} blocked the bot; unlinked.`);
      return;
    }
    this.logger.error(`Sending to ${row.userId} failed: ${message(cause)}`);
  }

  private async sendDaily(row: LinkRow): Promise<void> {
    const now = Date.now();
    const workouts = await loadWorkouts(row.userId, now);
    const weekStart = mondayOf(now, row.timeZone);
    const report = buildTrainingReport({ workouts, from: weekStart, to: now + 1, unit: unitOf(row), timeZone: row.timeZone, generatedAt: now });
    const last = workouts.at(-1);

    const text = dailyMessage({
      name: await firstName(row.userId),
      localHour: Math.floor(localClock(now, row.timeZone).minutes / 60),
      line: lineForDay(dayKey(now, row.timeZone)),
      last: last
        ? { name: last.name, daysAgo: Math.round((startOfDayIn(now, row.timeZone) - startOfDayIn(last.startedAt, row.timeZone)) / DAY_MS) }
        : null,
      week: { sessions: report.totals.sessions, sets: report.totals.sets, volumeKg: report.totals.volumeKg },
      upNext: await nextRoutineName(row.userId, now),
      unit: unitOf(row),
      hasLog: workouts.length > 0,
    });
    await this.client!.sendMessage(row.chatId!, text);
  }

  private async report(row: LinkRow, days: number) {
    const now = Date.now();
    const { from, to } = lastDaysWindow(now, days, row.timeZone);
    const [workouts, bodyweightKg, athlete] = await Promise.all([
      loadWorkouts(row.userId, to),
      latestBodyweightKg(row.userId),
      firstName(row.userId),
    ]);
    return buildTrainingReport({
      workouts: workouts satisfies ReportWorkoutRow[],
      from,
      to,
      unit: unitOf(row),
      timeZone: row.timeZone,
      athlete,
      generatedAt: now,
      ...(bodyweightKg !== undefined ? { bodyweightKg } : {}),
    });
  }

  private async sendReport(row: LinkRow, days: number): Promise<void> {
    const client = this.client!;
    await client.sendChatAction(row.chatId!, 'upload_document');
    const report = await this.report(row, days);
    const bytes = await renderReportPdf(report, this.loadFonts());
    const title = reportTitle(report.days);
    const fileName = `lift-${title.toLowerCase().replace(/\s+/g, '-')}-${dayKey(report.to - 1, row.timeZone)}.pdf`;
    await client.sendDocument(row.chatId!, bytes, fileName, reportSummary(report, title));
  }

  /**
   * JetBrains Sans, the app's face, read once. Two levels up from the
   * compiled `dist/telegram/`, the same arrangement as the migrations.
   */
  private loadFonts(): ReportFonts {
    if (this.fonts) return this.fonts;
    const dir = path.resolve(__dirname, '../../assets/fonts');
    const read = (file: string) => new Uint8Array(readFileSync(path.join(dir, file)));
    this.fonts = {
      regular: read('JetBrainsSans-Regular.ttf'),
      semibold: read('JetBrainsSans-SemiBold.ttf'),
      bold: read('JetBrainsSans-Bold.ttf'),
    };
    return this.fonts;
  }

  private async row(userId: string): Promise<LinkRow | undefined> {
    const [row] = await db.select().from(telegramLinks).where(eq(telegramLinks.userId, userId)).limit(1);
    return row;
  }

  private async rowByChat(chatId: string): Promise<LinkRow | undefined> {
    const [row] = await db.select().from(telegramLinks).where(eq(telegramLinks.chatId, chatId)).limit(1);
    return row;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Intent = 'week' | 'report' | 'streak' | 'quote' | 'pause' | 'resume' | 'today' | 'hello' | 'help';

/**
 * What a message is asking for. Commands first, then a few plain words, so
 * the buttons and someone typing "how was my week" land in the same place.
 */
export function intentOf(command: string, text: string): Intent {
  const commands: Record<string, Intent> = {
    '/week': 'week',
    '/stats': 'week',
    '/report': 'report',
    '/streak': 'streak',
    '/quote': 'quote',
    '/motivate': 'quote',
    '/pause': 'pause',
    '/stop': 'pause',
    '/resume': 'resume',
    '/today': 'today',
    '/help': 'help',
  };
  if (commands[command]) return commands[command];

  const words = text.toLowerCase();
  if (/\b(report|pdf)\b/.test(words)) return 'report';
  if (/\bstreak\b/.test(words)) return 'streak';
  if (/\b(motivat\w*|quote|inspire|lazy|tired|can'?t be bothered)\b/.test(words)) return 'quote';
  if (/\b(week|stats?|progress|how am i|how did i|how was)\b/.test(words)) return 'week';
  if (/\b(today|up next|what should i train)\b/.test(words)) return 'today';
  if (/^(hi|hey|hello|yo|sup|hiya|good (morning|afternoon|evening))\b/.test(words)) return 'hello';
  return 'help';
}

function settingsOf(row: LinkRow): TelegramSettings {
  return {
    timeZone: row.timeZone,
    unit: unitOf(row),
    dailyTime: row.dailyTime,
    dailyEnabled: row.dailyEnabled,
    weeklyEnabled: row.weeklyEnabled,
  };
}

function unitOf(row: LinkRow): 'kg' | 'lb' {
  return row.unit === 'lb' ? 'lb' : 'kg';
}

/** The local date, minutes past midnight and weekday, in the user's zone. */
function localClock(time: number, timeZone: string): { day: string; minutes: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(time));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { day: dayKey(time, timeZone), minutes: Number(get('hour')) * 60 + Number(get('minute')), weekday: get('weekday') };
}

function clockMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Local midnight at the start of this week's Monday. */
function mondayOf(time: number, timeZone: string): number {
  let day = startOfDayIn(time, timeZone);
  for (let i = 0; i < 7 && localClock(day, timeZone).weekday !== 'Mon'; i++) {
    day = startOfDayIn(day - 12 * 60 * 60 * 1000, timeZone);
  }
  return day;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
