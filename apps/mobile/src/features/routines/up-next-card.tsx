/**
 * The routine the log says comes next, with a Start on it, for the top of Home.
 *
 * Home answers "how is this week going", and the answer to that is not what
 * anybody opening the app before a session wants. They want the next routine,
 * and it lived a tab away. This card puts it where the app opens, with enough
 * of the routine on it (the first lifts and what each one asks for) that a
 * Start pressed here is a decision rather than a guess.
 *
 * That last part is why this card starts and the Workout tab's does not. The
 * one there is a name and a reason, and its note argues, correctly, that a name
 * is not enough to commit a session from. This one shows the lifts. It is the
 * routine screen's own argument for having a Start, made one level up.
 *
 * The choice is `suggestNextRoutine`'s, the same call the Workout tab makes on
 * the same two reads, so the two screens cannot name different routines. It
 * draws nothing when there is no suggestion (fewer than two routines, or every
 * one trained within the day) and nothing while a session is open, because the
 * tab bar's resume banner is already saying what the user is in the middle of.
 *
 * Kept to one glance: the lifts are a single line rather than a table, and the
 * card can be put away for the day. With the AI coach on, it also carries a
 * line or two about the session, written once a day (see `up-next-intro`).
 */

import { Ionicons } from '@expo/vector-icons';
import { suggestNextRoutine, isWorkingSet } from '@lift/shared';
import { and, asc, desc, isNotNull, isNull } from 'drizzle-orm';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button, Card, IconButton, PressableScale, Text } from '@/components/ui';
import { db } from '@/db/client';
import { routines as routinesTable, workouts, type RoutineSet } from '@/db/schema';
import { useRows } from '@/db/use-rows';
import { useAppUnits } from '@/features/exercises/units';
import { haptics } from '@/features/feedback/haptics';
import { startWorkout } from '@/features/workouts/repository';
import { startSession } from '@/features/workouts/start-session';
import { useTicker } from '@/hooks/use-ticker';
import { radius, spacing, useColors } from '@/theme';

import { describeLastPerformed } from './recency';
import { getRoutineDetail, type RoutineDetail } from './repository';
import { upNextKey, useUpNextDismissal, useUpNextIntro } from './up-next-intro';

/** Lifts named before "+N". Three is the opening of a session, not its plan. */
const PREVIEW_LIFTS = 3;

export function UpNextCard({ style }: { style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const { weightUnit } = useAppUnits();

  const { rows: activeRows, loaded: activeLoaded } = useRows(
    db
      .select({ id: workouts.id })
      .from(workouts)
      .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .limit(1),
  );

  const { rows: routines } = useRows(
    db
      .select()
      .from(routinesTable)
      .where(isNull(routinesTable.deletedAt))
      .orderBy(asc(routinesTable.position)),
  );

  // The same twenty finished sessions the Workout tab reads, for the same call.
  const { rows: recentSessions } = useRows(
    db
      .select({ routineId: workouts.routineId, startedAt: workouts.startedAt })
      .from(workouts)
      .where(and(isNotNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .orderBy(desc(workouts.startedAt))
      .limit(20),
  );

  // On the minute, which is as fast as "2 days ago" can turn over.
  const now = useTicker(60_000);
  const active = activeRows.length > 0;

  const suggestion = useMemo(
    () =>
      active || !activeLoaded
        ? null
        : suggestNextRoutine({
            routines: routines.map((routine) => ({
              id: routine.id,
              name: routine.name,
              lastPerformedAt: routine.lastPerformedAt?.getTime() ?? null,
            })),
            sessions: recentSessions.map((session) => ({
              routineId: session.routineId,
              startedAt: session.startedAt.getTime(),
            })),
            now,
          }),
    [active, activeLoaded, routines, recentSessions, now],
  );

  const routineId = suggestion?.routineId ?? null;
  const [detail, setDetail] = useState<RoutineDetail | null>(null);

  /*
   * The routine's lifts, read once per suggestion.
   *
   * Not live: a routine is edited on its own screen, and coming back to Home is
   * a focus, which re-renders this with the same id. The stale case is a
   * routine edited in another tab while this one stayed mounted, and the cost
   * of that is a preview a lift out of date until the next suggestion.
   */
  useEffect(() => {
    if (!routineId) return;
    let cancelled = false;

    void getRoutineDetail(routineId).then((next) => {
      if (!cancelled) setDetail(next ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [routineId]);

  // One latch for one Start, as on the Workout tab: a second tap inside the
  // round trip to disk would ask for a second session.
  const inFlight = useRef(false);
  const [starting, setStarting] = useState(false);

  const shown = detail && detail.routine.id === routineId ? detail : null;

  const reason = !suggestion
    ? ''
    : suggestion.basis === 'rotation'
      ? `Usually follows ${suggestion.after}`
      : describeLastPerformed(shown?.routine.lastPerformedAt ?? null, now);

  const key = routineId ? upNextKey(routineId, now) : null;
  const { dismissed, dismiss } = useUpNextDismissal(key);
  const intro = useUpNextIntro(dismissed === false ? key : null, shown, reason, weightUnit);

  if (!suggestion || !shown || dismissed !== false) return null;

  const { routine, exercises } = shown;

  const begin = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStarting(true);
    haptics.selection();

    try {
      const outcome = await startSession({
        create: () => startWorkout({ routineId: routine.id }),
        resumes: (open) => open.routineId === routine.id,
        openExisting: () => router.push('/workout/active'),
      });
      if (outcome === 'started' || outcome === 'resumed') router.push('/workout/active');
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  };

  const preview = exercises.slice(0, PREVIEW_LIFTS);
  const more = exercises.length - preview.length;
  const lifts = [
    ...preview.map(({ exercise, sets }) => `${exercise.name} ${describePrescription(sets)}`),
    ...(more > 0 ? [`+${more}`] : []),
  ].join('  ·  ');

  return (
    <Card padded={false} style={[styles.card, style]}>
      <View style={styles.top}>
        <PressableScale
          onPress={() => router.push({ pathname: '/routine/[id]', params: { id: routine.id } })}
          accessibilityRole="button"
          accessibilityLabel={`Up next: ${routine.name}. ${reason}`}
          accessibilityHint="Opens the routine"
          fill={colors.surface}
          fillPressed={colors.surfacePressed}
          scaleTo={1}
          style={styles.head}
        >
          <Text variant="overline" color="textTertiary" numberOfLines={1}>
            {`Up next  ·  ${reason}`}
          </Text>
          <Text variant="subheading" numberOfLines={1}>
            {routine.name}
          </Text>
          {lifts.length > 0 && (
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {lifts}
            </Text>
          )}
        </PressableScale>

        {/* Gone for today, not for good: see `up-next-intro`. */}
        <IconButton
          name="close"
          size={18}
          color={colors.textTertiary}
          onPress={() => {
            haptics.selection();
            dismiss();
          }}
          accessibilityLabel="Hide for today"
          style={styles.close}
        />
      </View>

      {/* The coach's line, only when the AI coach is on and has answered. The
          card is whole without it, so it arrives as an addition, never a wait. */}
      {intro && (
        <View style={[styles.intro, { backgroundColor: colors.accentSurface }]}>
          <Ionicons name="sparkles" size={14} color={colors.accent} style={styles.introIcon} />
          <Text variant="caption" style={styles.introText}>
            {intro}
          </Text>
        </View>
      )}

      {/* The accent, and the only control on Home that starts anything. */}
      <Button
        title={`Start ${routine.name}`}
        fullWidth
        loading={starting}
        onPress={() => void begin()}
        style={styles.start}
      />
    </Card>
  );
}

/**
 * What a routine asks of one lift, the way it is said at the rack: "3 × 8",
 * or "3 sets" when the working sets ask for different reps. Warm-ups are left
 * out: "3 × 8" is a statement about the work, and a ramp in front of it does
 * not make it "5 sets".
 */
function describePrescription(sets: readonly RoutineSet[]): string {
  const working = sets.filter((set) => isWorkingSet(set.setType));
  if (working.length === 0) return `${sets.length} ${sets.length === 1 ? 'set' : 'sets'}`;

  const reps = working[0]!.targetReps;
  const uniform = reps != null && working.every((set) => set.targetReps === reps);

  return uniform
    ? `${working.length} × ${reps}`
    : `${working.length} ${working.length === 1 ? 'set' : 'sets'}`;
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', borderRadius: radius.xl },
  top: { flexDirection: 'row', alignItems: 'flex-start' },
  head: {
    flex: 1,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingTop: spacing.md,
    gap: 2,
  },
  close: { marginTop: spacing.xs, marginRight: spacing.xs },
  intro: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  introIcon: { marginTop: 2 },
  introText: { flex: 1 },
  start: { marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.md },
});
