import { Ionicons } from '@expo/vector-icons';
import {
  analyzeSession,
  describeNextTime,
  formatDateTime,
  formatPrValue,
  isWorkingSet,
  PR_KIND_LABELS,
  type ExerciseSession,
  type MuscleGroup,
  type PrKind,
} from '@lift/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Confetti } from '@/components/celebration/confetti';
import { BodyMap } from '@/components/charts/body-map';
import { Button, Card, Divider, mastheadTitle, Screen, Text, useScrollEdge } from '@/components/ui';
import { SessionSummaryCard } from '@/features/ai/session-summary-card';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { db } from '@/db/client';
import {
  personalRecords,
  routineExercises,
  routineSets,
  workouts,
  type WorkoutSet,
} from '@/db/schema';
import {
  resolveExerciseUnits,
  useAppUnits,
  type ExerciseUnitOverrides,
} from '@/features/exercises/units';
import { compareWithLastTime } from '@/features/workouts/compare';
import {
  getPreviousPerformance,
  getWorkoutDetail,
  type WorkoutDetail,
} from '@/features/workouts/repository';
import { suggestForExercise } from '@/features/workouts/suggestion';
import { ExerciseDebrief } from '@/features/workouts/summary/exercise-debrief';
import { VerdictCard } from '@/features/workouts/summary/verdict-card';
import { useSettings } from '@/store/settings';
import { spacing, stroke, useColors } from '@/theme';

/**
 * The colophon's date: no year, because this screen is only ever reached
 * precisely when the workout finishes.
 */
const HERO_DATE: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
};

interface PrSummary {
  kind: PrKind;
  value: number;
  /**
   * The best this record beat, or null when it is the first of its kind.
   *
   * A record on its own is a number; beside the one it replaced it is a jump,
   * and the size of the jump is the part worth seeing. Read from the earlier
   * rows of the same table, which only ever holds a row when a best was beaten,
   * so the largest earlier value is exactly the previous best.
   */
  previous: number | null;
  exerciseName: string;
  /**
   * Evaluated from the exercise exactly as the logging screen does it, so an
   * imported 100 lb record is correctly formatted as "100 lb" even on a phone
   * that prefers kg and has never seen the workout the record was set in.
   *
   * An older design did not store `exerciseId` on the record and formatted
   * using the phone's preference, which meant switching the app to kg made an
   * imported 100 lb record read as "100 kg". A record belongs to an exercise
   * that may not agree on one.
   */
  units: ExerciseUnitOverrides;
}

export default function WorkoutSummaryScreen() {
  const scrollEdge = useScrollEdge();
  const { width: windowWidth } = useWindowDimensions();

  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const appUnits = useAppUnits();
  const { weightUnit } = appUnits;
  const reduceMotion = useReduceMotion();

  const [detail, setDetail] = useState<WorkoutDetail | null>(null);
  const [prs, setPrs] = useState<PrSummary[]>([]);
  // Last time's completed sets per lift in this session, keyed by the link id.
  const [lastTime, setLastTime] = useState<Record<string, WorkoutSet[]>>({});
  // The run of sessions behind each lift, newest first, for "Next time".
  const [history, setHistory] = useState<Record<string, ExerciseSession[]>>({});
  /**
   * The total volume of the last finished run of the same routine, or null.
   *
   * The comparison a lifter actually makes: not "more than my average", which
   * mixes leg days with arm days, but "more than last Push A".
   */
  const [previousRoutineVolume, setPreviousRoutineVolume] = useState<number | null>(null);
  // The reps the routine prescribes per exercise, which outrank inferred ranges.
  const [prescribed, setPrescribed] = useState<Record<string, number>>({});

  const bodyweightKg = useSettings((state) => state.bodyweightKg);
  const formula = useSettings((state) => state.oneRepMaxFormula);
  const targetRpe = useSettings((state) => state.defaultRpe);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const loaded = await getWorkoutDetail(id);
      if (cancelled || !loaded) return;
      setDetail(loaded);

      const records = await db
        .select()
        .from(personalRecords)
        .where(and(eq(personalRecords.workoutId, id), isNull(personalRecords.deletedAt)));

      const exerciseById = new Map(
        loaded.exercises.map((entry) => [entry.exercise.id, entry.exercise]),
      );

      const exerciseIds = [...new Set(records.map((record) => record.exerciseId))];
      const earlier =
        exerciseIds.length === 0
          ? []
          : await db
              .select({
                exerciseId: personalRecords.exerciseId,
                kind: personalRecords.kind,
                value: personalRecords.value,
              })
              .from(personalRecords)
              .where(
                and(
                  inArray(personalRecords.exerciseId, exerciseIds),
                  ne(personalRecords.workoutId, id),
                  isNull(personalRecords.deletedAt),
                ),
              );

      const previousBest = new Map<string, number>();
      for (const row of earlier) {
        const key = `${row.exerciseId}:${row.kind}`;
        previousBest.set(key, Math.max(previousBest.get(key) ?? -Infinity, row.value));
      }

      if (!cancelled) {
        setPrs(
          records.map((record) => {
            const exercise = exerciseById.get(record.exerciseId);

            return {
              kind: record.kind,
              value: record.value,
              previous: previousBest.get(`${record.exerciseId}:${record.kind}`) ?? null,
              exerciseName: exercise?.name ?? 'Exercise',
              units: {
                weightUnit: exercise?.weightUnit ?? null,
                distanceUnit: exercise?.distanceUnit ?? null,
              },
            };
          }),
        );
      }

      /*
       * Last time, per lift, bounded by when this session started: the newest
       * other session would otherwise be a later one when this screen is
       * reopened from History months on. Read after the records so the screen
       * fills top-down, in the order it is read.
       */
      const before = loaded.workout.startedAt.getTime();
      const previous = await Promise.all(
        loaded.exercises.map(
          async (entry) =>
            [
              entry.workoutExercise.id,
              await getPreviousPerformance(entry.exercise.id, { excludeWorkoutId: id, before }),
            ] as const,
        ),
      );

      if (!cancelled) {
        setLastTime(Object.fromEntries(previous.map(([key, performance]) => [key, performance.sets])));
        setHistory(
          Object.fromEntries(previous.map(([key, performance]) => [key, performance.sessions])),
        );
      }

      const routineId = loaded.workout.routineId;
      if (!routineId) return;

      const [lastRun] = await db
        .select({ totalVolumeKg: workouts.totalVolumeKg })
        .from(workouts)
        .where(
          and(
            eq(workouts.routineId, routineId),
            ne(workouts.id, id),
            isNotNull(workouts.finishedAt),
            lt(workouts.startedAt, loaded.workout.startedAt),
            isNull(workouts.deletedAt),
          ),
        )
        .orderBy(desc(workouts.startedAt))
        .limit(1);

      const targets = await db
        .select({
          exerciseId: routineExercises.exerciseId,
          setType: routineSets.setType,
          targetReps: routineSets.targetReps,
        })
        .from(routineSets)
        .innerJoin(routineExercises, eq(routineSets.routineExerciseId, routineExercises.id))
        .where(
          and(
            eq(routineExercises.routineId, routineId),
            isNull(routineExercises.deletedAt),
            isNull(routineSets.deletedAt),
          ),
        )
        .orderBy(asc(routineSets.position));

      // Working sets only, and the first one wins: the same reading of a
      // routine the logging screen makes, so both screens suggest one number.
      const reps: Record<string, number> = {};
      for (const target of targets) {
        if (target.targetReps == null || !isWorkingSet(target.setType)) continue;
        if (!(target.exerciseId in reps)) reps[target.exerciseId] = target.targetReps;
      }

      if (!cancelled) {
        setPreviousRoutineVolume(lastRun?.totalVolumeKg ?? null);
        setPrescribed(reps);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const sessionMuscles = useMemo(() => {
    if (!detail) return {};
    const counts: Partial<Record<MuscleGroup, number>> = {};
    for (const entry of detail.exercises) {
      const workingSets = entry.sets.filter((s) => isWorkingSet(s.setType)).length;
      if (workingSets === 0) continue;
      
      const ex = entry.exercise;
      counts[ex.primaryMuscle] = (counts[ex.primaryMuscle] ?? 0) + workingSets;
    }
    return counts;
  }, [detail]);

  const insights = useMemo(() => {
    if (!detail) return null;
    return analyzeSession({
      exercises: detail.exercises.map((entry) => ({
        id: entry.workoutExercise.id,
        name: entry.exercise.name,
        trackingType: entry.exercise.trackingType,
        today: entry.sets,
        // Absent until the history query lands, and absent is not "first time":
        // reading it as null would flash every lift as new for a frame.
        lastTime: lastTime[entry.workoutExercise.id] ?? null,
      })),
      recordCount: prs.length,
      volumeKg: detail.workout.totalVolumeKg,
      previousRoutineVolumeKg: previousRoutineVolume,
      bodyweightKg,
      formula,
    });
  }, [detail, lastTime, prs.length, previousRoutineVolume, bodyweightKg, formula]);

  /**
   * "Next time", per lift, from the same engine the logging screen asks.
   *
   * Today's sets go in as the newest session, because the question is about
   * the session after this one. Only completed sets are passed as the session
   * itself: an unticked set left open would otherwise be read by the
   * mid-session engine as one still to lift, and the line would be a plan for
   * the next four minutes rather than for next week.
   */
  const nextTime = useMemo(() => {
    if (!detail) return {};
    const lines: Record<string, { text: string; reason: string } | null> = {};

    for (const entry of detail.exercises) {
      const done = entry.sets.filter((set) => set.isCompleted);
      const working = done.filter((set) => isWorkingSet(set.setType));
      if (working.length === 0) continue;

      const suggestion = suggestForExercise(
        { ...entry, sets: done },
        {
          sessions: [
            { startedAt: detail.workout.startedAt.getTime(), sets: working },
            ...(history[entry.workoutExercise.id] ?? []),
          ],
          targetReps: prescribed[entry.exercise.id] ?? null,
          targetRpe,
          bodyweightKg,
        },
      );

      const unit = resolveExerciseUnits(entry.exercise, appUnits).weightUnit;
      const text = suggestion ? describeNextTime(suggestion, unit) : null;
      lines[entry.workoutExercise.id] = suggestion && text ? { text, reason: suggestion.reason } : null;
    }

    return lines;
  }, [detail, history, prescribed, targetRpe, bodyweightKg, appUnits]);

  // Declared once and rendered in both branches. A native-stack screen reads
  // its options as the push animation starts, so setting them only in the
  // loaded branch meant the header slid in labelled "Summary" and relabelled
  // itself a beat later, mid-transition.
  const header = (
    <Stack.Screen
      options={{
        title: 'Workout complete',
        // Back would return to the now-finished logging screen, so the only
        // way out is forward.
        //
        // And forward is the full-width Done at the foot of the content, not a
        // second copy of it up here. The consistency pass that filled Save,
        // Done and Log elsewhere deliberately left this header empty: a summary
        // is read top to bottom and ends on its own exit, so a header action
        // would be the same destination offered twice on one screen, and the
        // one in the content is the larger, more obvious target of the two.
        headerBackVisible: false,
        // Which leaves a bar with nothing in it but the title, and the stack's
        // centred title exists to sit over a back chevron that this screen has
        // just removed. Alone in the middle of an empty bar it reads as a
        // dialog's caption; on the margin it is the first line of the page,
        // above the hero that follows it.
        ...mastheadTitle(colors),
      }}
    />
  );

  if (!detail) return <Screen scrolled={scrollEdge.progress}>{header}</Screen>;

  const { workout, exercises } = detail;

  // Gold-led: this burst only ever runs for a record.
  const confettiColors = [colors.record, colors.warning, colors.success, colors.accent];

  return (
    <Screen scrolled={scrollEdge.progress}>
      {header}

      {/* Records only. Firing on every finished session made the burst mean
          "you stopped logging", which is not an achievement, and it left the
          app with nothing louder to say on the day someone actually beat a
          number. It mounts when the record query resolves, so the burst lands
          with the numbers rather than over an empty screen. */}
      {!reduceMotion && prs.length > 0 && (
        <Confetti runKey={prs.length} count={70} durationMs={3200} colors={confettiColors} />
      )}

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        {/*
         * A colophon, not a trophy screen.
         *
         * The header already says "Workout complete"; a 72px lime disc with a
         * checkmark in it was the second time in one viewport that the screen
         * congratulated the user, and it pushed the numbers they actually came
         * for below the fold. The date leads as a tracked overline, the session
         * name is the headline, and the record itself starts immediately.
         */}
        <View style={styles.hero}>
          <Text variant="overline" color="textTertiary">
            {formatDateTime(workout.startedAt, HERO_DATE)}
          </Text>
          <Text variant="title">{workout.name}</Text>
        </View>

        {/*
         * The verdict and the totals, first.
         *
         * Read in the order the questions come: was it a good session, then how
         * much work was it. Records follow directly, gold, as the one thing on
         * the screen the user did not already watch accumulate in the header.
         */}
        {insights && (
          <VerdictCard
            insights={insights}
            volumeKg={workout.totalVolumeKg}
            durationSeconds={workout.durationSeconds ?? 0}
            totalSets={workout.totalSets}
            totalReps={workout.totalReps}
            weightUnit={weightUnit}
          />
        )}

        {prs.length > 0 && (
          <Card style={[styles.prCard, { borderColor: colors.record }]}>
            <View style={styles.prHeader}>
              <Ionicons name="trophy" size={18} color={colors.record} />
              <Text variant="bodyMedium" color="record">
                {prs.length === 1 ? '1 personal record' : `${prs.length} personal records`}
              </Text>
            </View>
            {prs.map((pr, index) => {
              const unit = resolveExerciseUnits(pr.units, appUnits).weightUnit;
              return (
                <View key={`${pr.kind}-${index}`} style={styles.prRow}>
                  <View style={styles.prName}>
                    <Text variant="label" numberOfLines={1}>
                      {pr.exerciseName}
                    </Text>
                    <Text variant="caption" color="textSecondary">
                      {PR_KIND_LABELS[pr.kind]}
                    </Text>
                  </View>
                  <View style={styles.prValue}>
                    <Text variant="numeric" color="record">
                      {formatPrValue(pr.kind, pr.value, unit)}
                    </Text>
                    {pr.previous !== null && (
                      <Text variant="caption" color="textTertiary">
                        {`was ${formatPrValue(pr.kind, pr.previous, unit)}`}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </Card>
        )}

        {/*
         * After the totals, before the body map.
         *
         * The figures above are what happened and are on screen the instant
         * this route opens. This is the reading of them, and it belongs on the
         * same side of the screen as the numbers it refers to rather than under
         * the exercise list, where it would be read after the user had already
         * scrolled past everything it is about.
         *
         * It renders nothing at all when the AI coach is off, which is the
         * default, so this screen is unchanged for anyone who never sets a key.
         */}
        <SessionSummaryCard workoutId={id} />

        <Text variant="overline" color="textSecondary" style={styles.sectionHeading}>
          Lift by lift
        </Text>
        <Card padded={false}>
          {exercises.map((entry, index) => {
            const insight = insights?.exercises.find(
              (candidate) => candidate.id === entry.workoutExercise.id,
            );
            if (!insight) return null;

            const units = resolveExerciseUnits(entry.exercise, appUnits);
            const previous = lastTime[entry.workoutExercise.id];
            const comparison = previous
              ? compareWithLastTime(entry.sets, previous, entry.exercise.trackingType, units.weightUnit)
              : null;
            const next = nextTime[entry.workoutExercise.id] ?? null;

            return (
              <View key={entry.workoutExercise.id}>
                {index > 0 && <Divider />}
                <ExerciseDebrief
                  insight={insight}
                  sets={entry.sets}
                  comparison={comparison}
                  nextTime={next?.text ?? null}
                  nextReason={next?.reason ?? null}
                  weightUnit={units.weightUnit}
                  distanceUnit={units.distanceUnit}
                />
              </View>
            );
          })}
        </Card>

        <Text variant="overline" color="textSecondary" style={styles.sectionHeading}>
          Muscles trained
        </Text>
        <Card style={styles.mapCard}>
          <BodyMap width={windowWidth - spacing.lg * 4} setsPerWeek={sessionMuscles} maxHeight={280} />
        </Card>

        <Button
          title="Done"
          size="lg"
          fullWidth
          onPress={() => router.replace('/(tabs)')}
          style={styles.done}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },
  hero: { gap: spacing.xs, paddingTop: spacing.xl, paddingBottom: spacing.sm },
  sectionHeading: {
    marginTop: spacing.md,
    marginBottom: -spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  prCard: { gap: spacing.sm, borderWidth: stroke.outline },
  mapCard: { padding: spacing.sm, alignItems: 'center' },
  prHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prName: { flex: 1, gap: 2 },
  prValue: { alignItems: 'flex-end', gap: 2 },
  done: { marginTop: spacing.lg },
});
