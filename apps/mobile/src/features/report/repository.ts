/**
 * The phone's log, read into the rows `@lift/shared/report` builds from.
 *
 * The server does the same from Postgres for the Telegram bot; both go through
 * `buildTrainingReport`, so an exported report and the one the bot sends agree.
 */

import type { ReportWorkoutRow } from '@lift/shared/report';
import { and, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm';

import { db } from '@/db/client';
import { bodyMeasurements, exercises, workoutExercises, workoutSets, workouts } from '@/db/schema';

/** Every finished workout before `to`. Older ones are what records are measured against. */
export async function loadReportWorkouts(to: number): Promise<ReportWorkoutRow[]> {
  const rows = await db
    .select({
      workoutId: workouts.id,
      name: workouts.name,
      startedAt: workouts.startedAt,
      durationSeconds: workouts.durationSeconds,
      exerciseId: workoutExercises.exerciseId,
      exerciseName: exercises.name,
      primaryMuscle: exercises.primaryMuscle,
      trackingType: exercises.trackingType,
      setType: workoutSets.setType,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
      setDuration: workoutSets.durationSeconds,
      distanceKm: workoutSets.distanceKm,
      isCompleted: workoutSets.isCompleted,
    })
    .from(workouts)
    .leftJoin(workoutExercises, and(eq(workoutExercises.workoutId, workouts.id), isNull(workoutExercises.deletedAt)))
    .leftJoin(exercises, eq(exercises.id, workoutExercises.exerciseId))
    .leftJoin(workoutSets, and(eq(workoutSets.workoutExerciseId, workoutExercises.id), isNull(workoutSets.deletedAt)))
    .where(and(isNotNull(workouts.finishedAt), isNull(workouts.deletedAt), lt(workouts.startedAt, new Date(to))));

  const byWorkout = new Map<string, ReportWorkoutRow>();
  for (const row of rows) {
    let workout = byWorkout.get(row.workoutId);
    if (!workout) {
      workout = {
        id: row.workoutId,
        name: row.name,
        startedAt: row.startedAt.getTime(),
        durationSeconds: row.durationSeconds,
        sets: [],
      };
      byWorkout.set(row.workoutId, workout);
    }
    if (!row.exerciseId || row.setType === null || row.isCompleted === null) continue;

    workout.sets.push({
      exerciseId: row.exerciseId,
      exerciseName: row.exerciseName ?? 'Exercise',
      primaryMuscle: row.primaryMuscle ?? null,
      trackingType: row.trackingType ?? 'weight_reps',
      setType: row.setType,
      weightKg: row.weightKg,
      reps: row.reps,
      durationSeconds: row.setDuration,
      distanceKm: row.distanceKm,
      isCompleted: row.isCompleted,
    });
  }

  return [...byWorkout.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/** The latest logged bodyweight, so bodyweight exercises count towards volume. */
export async function latestBodyweightKg(): Promise<number | undefined> {
  const [row] = await db
    .select({ value: bodyMeasurements.value })
    .from(bodyMeasurements)
    .where(and(eq(bodyMeasurements.kind, 'bodyweight'), isNull(bodyMeasurements.deletedAt)))
    .orderBy(desc(bodyMeasurements.measuredAt))
    .limit(1);
  return row?.value;
}
