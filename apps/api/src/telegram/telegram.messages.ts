/**
 * Everything the bot says, as Telegram HTML.
 *
 * Kept apart from the service so the words can be read in one place, and so
 * none of them depends on a socket. No model writes any of this: the numbers
 * come from the report, and the sentences around them are fixed.
 */

import {
  formatPeriod,
  formatTonnage,
  groupThousands,
  percentChange,
  toUnit,
  type TrainingReport,
} from '@lift/shared/report';

import { escapeHtml } from './telegram.client.js';

export interface DailyFacts {
  name: string | null;
  localHour: number;
  line: string;
  /** The most recent session, or null for an empty log. */
  last: { name: string; daysAgo: number } | null;
  /** Monday to now. */
  week: { sessions: number; sets: number; volumeKg: number };
  upNext: string | null;
  unit: 'kg' | 'lb';
  hasLog: boolean;
}

export function dailyMessage(facts: DailyFacts): string {
  const greeting = facts.localHour < 12 ? 'Good morning' : facts.localHour < 18 ? 'Good afternoon' : 'Good evening';
  const lines = [`<b>${greeting}${facts.name ? `, ${escapeHtml(facts.name)}` : ''}.</b>`, '', `<i>“${escapeHtml(facts.line)}”</i>`, ''];

  if (!facts.hasLog) {
    lines.push('Nothing synced yet. Sign in on your phone in Lift and your numbers will show up here.');
    return lines.join('\n');
  }

  if (facts.last) {
    const when = facts.last.daysAgo === 0 ? 'today' : facts.last.daysAgo === 1 ? 'yesterday' : `${facts.last.daysAgo} days ago`;
    lines.push(`Last session: <b>${escapeHtml(facts.last.name)}</b>, ${when}`);
  }

  const { sessions, sets, volumeKg } = facts.week;
  lines.push(
    sessions === 0
      ? 'This week so far: nothing yet. Today is a good day to change that.'
      : `This week so far: ${sessions} ${sessions === 1 ? 'session' : 'sessions'} · ${sets} sets · ${formatTonnage(volumeKg, facts.unit)}`,
  );

  if (facts.upNext) lines.push(`Up next: <b>${escapeHtml(facts.upNext)}</b>`);
  return lines.join('\n');
}

/** The text that goes with a report, or stands in for one with `/week`. */
export function reportSummary(report: TrainingReport, heading: string): string {
  const { totals, previous, unit } = report;
  const period = formatPeriod(report.from, report.to, report.timeZone);
  const lines = [`<b>${escapeHtml(heading)}</b> · ${escapeHtml(period)}`, ''];

  if (totals.sessions === 0) {
    lines.push('No sessions logged in this window.');
    return lines.join('\n');
  }

  const change = previous.sessions > 0 ? percentChange(totals.volumeKg, previous.volumeKg) : null;
  const trend = change === null || change === 0 ? '' : change > 0 ? ` (▲ ${change}%)` : ` (▼ ${Math.abs(change)}%)`;
  lines.push(`🏋️ ${totals.sessions} ${totals.sessions === 1 ? 'session' : 'sessions'} over ${totals.trainingDays} ${totals.trainingDays === 1 ? 'day' : 'days'}`);
  lines.push(`Moved <b>${formatTonnage(totals.volumeKg, unit)}</b>${trend}`);
  lines.push(`${groupThousands(totals.sets)} working sets · ${groupThousands(totals.reps)} reps · ${formatMinutes(totals.minutes)}`);

  if (report.records.length > 0) {
    lines.push('', '⭐ <b>New records</b>');
    for (const record of report.records.slice(0, 3)) {
      const gain = record.previousKg === null ? '' : ` (+${weight(record.oneRepMaxKg - record.previousKg, unit)})`;
      lines.push(`${escapeHtml(record.name)}: ${weight(record.oneRepMaxKg, unit)} est.${gain}`);
    }
  }

  if (report.highlights.length > 0) {
    lines.push('');
    for (const note of report.highlights.slice(0, 2)) lines.push(`• ${escapeHtml(note)}`);
  }

  return lines.join('\n');
}

export function streakMessage(weeks: number): string {
  if (weeks === 0) return 'No streak running right now. One session this week starts a new one.';
  if (weeks === 1) return '🔥 <b>1 week</b> in a row with at least one session. Keep it going.';
  return `🔥 <b>${weeks} weeks</b> in a row with at least one session. That is how strong gets built.`;
}

export const HELP = [
  '<b>What I can do</b>',
  '',
  'Every day at your chosen time: a line to get you moving, and where your week stands.',
  'Every Monday: last week as a PDF report.',
  '',
  '/week: the last 7 days',
  '/report: last week as a PDF (/report month for 30 days)',
  '/streak: weeks in a row you have trained',
  '/quote: today’s line',
  '/pause and /resume: the daily message',
  '',
  'Times, units and the rest are in the app, under Settings, Telegram.',
].join('\n');

export const NOT_LINKED =
  'This chat is not connected to Lift yet. Open the app, go to <b>Settings › Telegram</b> and tap <b>Connect</b>.';

export function welcome(name: string | null, dailyTime: string): string {
  return [
    `<b>Connected${name ? `, ${escapeHtml(name)}` : ''}.</b> 💪`,
    '',
    `You will hear from me every day at ${dailyTime}, and get a PDF of your week every Monday.`,
    'Tap the buttons below any time, or send /help.',
  ].join('\n');
}

function weight(kg: number, unit: 'kg' | 'lb'): string {
  const value = toUnit(kg, unit);
  return `${value >= 100 ? Math.round(value) : Math.round(value * 2) / 2} ${unit}`;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h ${rest}m`;
}
