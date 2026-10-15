import { Ionicons } from '@expo/vector-icons';
import { formatClockTime } from '@lift/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';

import { Button, Card, Divider, Reveal, Text, TimePickerModal } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { Footnote, SettingsPage, settingsStyles } from '@/features/settings/page';
import { SettingAction, SettingToggle, SettingValue } from '@/features/settings/rows';
import { useSession } from '@/features/sync/auth-client';
import {
  connectTelegram,
  deviceTimeZone,
  disconnectTelegram,
  getTelegramStatus,
  sendTelegramTest,
  updateTelegram,
  type TelegramSettings,
  type TelegramStatus,
} from '@/features/telegram/api';
import { showAlert, showConfirm } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

/** How long to keep checking for the Start press after sending someone to Telegram. */
const WAIT_FOR_START_MS = 3 * 60 * 1000;
const POLL_MS = 2500;

/**
 * The Telegram bot: a line to get moving every day at the reminder time,
 * last week as a PDF every Monday, and stats on request.
 *
 * Connecting is two taps. "Connect" asks the server for a one-time link and
 * opens Telegram on it; pressing Start there finishes the job. While the user
 * is away in Telegram this screen keeps asking whether the link has landed, so
 * coming back to it shows "Connected" without a refresh.
 *
 * The bot runs on the server and reads the synced log, so the whole page needs
 * an account. Signed out, it says that and offers sign-in instead.
 */
export default function TelegramSettingsScreen() {
  const colors = useColors();
  const { data: session, isPending: sessionPending } = useSession();
  const unit = useSettings((state) => state.weightUnit);
  const reminderTime = useSettings((state) => state.gymReminderTime);

  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<'connect' | 'daily' | 'report' | null>(null);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [editingTime, setEditingTime] = useState(false);
  const synced = useRef(false);
  /** When the user was sent to Telegram, read by `refresh` without re-creating it. */
  const waitStarted = useRef<number | null>(null);

  const signedIn = !!session?.user;

  const refresh = useCallback(async () => {
    try {
      const next = await getTelegramStatus();
      setStatus(next);
      setFailed(null);

      // Stop waiting once Start has been pressed, or once it plainly will not be.
      const started = waitStarted.current;
      if (started !== null && (next.linked || Date.now() - started > WAIT_FOR_START_MS)) {
        if (next.linked) haptics.logged();
        waitStarted.current = null;
        setWaitingSince(null);
      }
    } catch (cause) {
      setFailed(cause instanceof Error ? cause.message : 'The server could not be reached.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (signedIn) void refresh();
    }, [signedIn, refresh]),
  );

  // While waiting for Start to be pressed: check on a short interval, and at
  // once when the app comes back to the foreground, which is the usual moment
  // it lands.
  useEffect(() => {
    if (waitingSince === null) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [waitingSince, refresh]);

  // The bot counts days in the zone and unit it was given. A phone that has
  // travelled, or switched to pounds, quietly brings the bot along.
  useEffect(() => {
    const settings = status?.settings;
    if (!status?.linked || !settings || synced.current) return;
    synced.current = true;
    const zone = deviceTimeZone();
    if (settings.timeZone !== zone || settings.unit !== unit) {
      void updateTelegram({ timeZone: zone, unit }).then(setStatus).catch(() => {});
    }
  }, [status, unit]);

  const connect = useCallback(async () => {
    setBusy('connect');
    try {
      const settings: TelegramSettings = {
        timeZone: deviceTimeZone(),
        unit,
        // The daily line rides with the gym reminder the user already chose.
        dailyTime: reminderTime,
        dailyEnabled: true,
        weeklyEnabled: true,
      };
      const { url } = await connectTelegram(settings);
      waitStarted.current = Date.now();
      setWaitingSince(waitStarted.current);
      await Linking.openURL(url);
    } catch (cause) {
      void showAlert('Could not start connecting', cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  }, [unit, reminderTime]);

  const change = useCallback(async (settings: Partial<TelegramSettings>) => {
    // Shown at once, put right if the server says otherwise.
    setStatus((current) =>
      current?.settings ? { ...current, settings: { ...current.settings, ...settings } } : current,
    );
    try {
      setStatus(await updateTelegram(settings));
    } catch {
      void refresh();
      void showAlert('That change did not save', 'Check your connection and try again.');
    }
  }, [refresh]);

  const test = useCallback(async (kind: 'daily' | 'report') => {
    setBusy(kind);
    try {
      await sendTelegramTest(kind);
      haptics.added();
    } catch (cause) {
      void showAlert('Nothing was sent', cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const confirmed = await showConfirm({
      title: 'Disconnect Telegram?',
      message: 'The bot stops messaging you. You can connect again any time.',
      confirmLabel: 'Disconnect',
    });
    if (!confirmed) return;
    haptics.destructive();
    await disconnectTelegram().catch(() => {});
    synced.current = false;
    void refresh();
  }, [refresh]);

  const settings = status?.settings;
  const linked = !!status?.linked && !!settings;

  return (
    <SettingsPage title="Telegram">
      <Reveal>
        <View style={[styles.hero, settingsStyles.first, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.badge, { backgroundColor: colors.accentSurface }]}>
            <Ionicons name="paper-plane" size={22} color={colors.accent} />
          </View>
          <Text variant="heading">Lift on Telegram</Text>
          <View style={styles.points}>
            <Point icon="sunny-outline" text="A line to get you moving, every day at your reminder time" />
            <Point icon="document-text-outline" text="Last week as a designed PDF report, every Monday" />
            <Point icon="chatbubble-ellipses-outline" text="Ask for your week, your streak or a report any time" />
          </View>

          {!signedIn && !sessionPending && (
            <>
              <Text variant="caption" color="textSecondary">
                The bot reads your synced log, so it needs an account.
              </Text>
              <Button title="Sign in to connect" icon="person-circle-outline" onPress={() => router.push('/sign-in')} />
            </>
          )}

          {signedIn && status && !status.available && (
            <Text variant="caption" color="textSecondary">
              The Telegram bot is not set up on this server yet.
            </Text>
          )}

          {signedIn && failed && !status && (
            <Text variant="caption" color="danger">
              {failed}
            </Text>
          )}

          {signedIn && status?.available && !status.linked && (
            <>
              <Button
                title={waitingSince ? 'Open Telegram again' : 'Connect Telegram'}
                icon="paper-plane-outline"
                loading={busy === 'connect'}
                onPress={() => void connect()}
              />
              {waitingSince !== null && (
                <Text variant="caption" color="textSecondary" align="center">
                  Press <Text variant="label">Start</Text> in Telegram, then come back. This page updates by itself.
                </Text>
              )}
            </>
          )}

          {linked && (
            <View style={[styles.connected, { backgroundColor: colors.successSurface }]}>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Text variant="label" color="success">
                Connected{status.username ? ` as @${status.username}` : ''}
              </Text>
            </View>
          )}
        </View>
      </Reveal>

      {linked && (
        <Reveal index={1}>
          <Card padded={false} style={settingsStyles.sectionStacked}>
            <SettingToggle
              icon="sunny-outline"
              label="Daily message"
              description={`A line and where your week stands, at ${formatClockTime(settings.dailyTime)}.`}
              value={settings.dailyEnabled}
              onChange={(value) => void change({ dailyEnabled: value })}
            />
            <Divider inset={spacing.lg} />
            <SettingValue
              icon="time-outline"
              label="Send at"
              value={formatClockTime(settings.dailyTime)}
              hint="Opens the time picker"
              onPress={() => setEditingTime(true)}
            />
            <Divider inset={spacing.lg} />
            <SettingToggle
              icon="document-text-outline"
              label="Weekly report"
              description="Last week as a PDF, on Monday at the same time."
              value={settings.weeklyEnabled}
              onChange={(value) => void change({ weeklyEnabled: value })}
            />
          </Card>

          <Card padded={false} style={settingsStyles.sectionStacked}>
            <SettingAction
              icon="chatbubble-outline"
              label={busy === 'daily' ? 'Sending…' : "Send today's message now"}
              tone="neutral"
              disabled={busy !== null}
              onPress={() => void test('daily')}
            />
            <Divider inset={spacing.lg} />
            <SettingAction
              icon="document-attach-outline"
              label={busy === 'report' ? 'Making the PDF…' : "Send last week's report now"}
              tone="neutral"
              disabled={busy !== null}
              onPress={() => void test('report')}
            />
          </Card>

          <Card padded={false} style={settingsStyles.sectionStacked}>
            <SettingAction icon="unlink-outline" label="Disconnect" onPress={() => void disconnect()} />
          </Card>
          <Footnote>
            The bot works from what has synced to your account, and counts days in{' '}
            {settings.timeZone.replace(/_/g, ' ')}. In the chat, send /help to see what it can do.
          </Footnote>
        </Reveal>
      )}

      {settings && (
        <TimePickerModal
          visible={editingTime}
          title="Daily message"
          message="Every day, and Mondays bring the report too."
          value={settings.dailyTime}
          onCancel={() => setEditingTime(false)}
          onConfirm={(time) => {
            setEditingTime(false);
            void change({ dailyTime: time });
          }}
        />
      )}
    </SettingsPage>
  );
}

function Point({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const colors = useColors();
  return (
    <View style={styles.point}>
      <Ionicons name={icon} size={16} color={colors.accent} style={styles.pointIcon} />
      <Text variant="body" color="textSecondary" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.xl, gap: spacing.lg },
  badge: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  points: { gap: spacing.md },
  point: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  pointIcon: { marginTop: 3 },
  connected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
});
