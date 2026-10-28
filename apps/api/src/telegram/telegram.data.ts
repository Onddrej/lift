/**
 * What the bot knows about someone's training: the synced log, read back into
 * the shapes `@lift/shared/report` builds from.
 *
 * Only what has been synced is here. A user who links Telegram but never signs
 * in on the phone has an empty log as far as this server can tell, and the bot
 * says so rather than reporting a week of nothing as if it were true.
 */

import { suggestNextRoutine, type MuscleGroup, type SetType, type TrackingType } from '@lift/shared';
import { EXERCISE_LIBRARY } from '@lift/shared/exercises';
import type { ReportWorkoutRow } from '@lift/shared/report';
import { and, desc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';

import { db, schema } from '../db/client.js';

const { workouts, workoutExercises, workoutSets, exercises, routines, bodyMeasurements, user } = schema;

interface ExerciseInfo {
  name: string;
  primaryMuscle: MuscleGroup | null;
  trackingType: TrackingType;
}

/**
 * The built-in catalog, by id.
 *
 * It never crosses the wire (see the note on the schema's foreign keys), so a
 * logged bench press arrives here as `bench-press-barbell` and nothing else.
 * The same catalog the phones seed from turns it back into a name.
 */
let library: Map<string, ExerciseInfo> | null = null;
function libraryById(): Map<string, ExerciseInfo> {
  library ??= new Map(
    EXERCISE_LIBRARY.map((exercise) => [
      exercise.id,
      { name: exercise.name, primaryMuscle: exercise.primaryMuscle, trackingType: exercise.trackingType },
    ]),
  );
  return library;
}

/** Every finished workout before `to`, with its sets, ready for `buildTrainingReport`. */
export async function loadWorkouts(userId: string, to: number): Promise<ReportWorkoutRow[]> {
  const rows = await db
    .select({
      workoutId: workouts.id,
      name: workouts.name,
      startedAt: workouts.startedAt,
      durationSeconds: workouts.durationSeconds,
      exerciseId: workoutExercises.exerciseId,
      setType: workoutSets.setType,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
      setDuration: workoutSets.durationSeconds,
      distanceKm: workoutSets.distanceKm,
      isCompleted: workoutSets.isCompleted,
    })
    .from(workouts)
    .leftJoin(
      workoutExercises,
      and(eq(workoutExercises.workoutId, workouts.id), isNull(workoutExercises.deletedAt)),
    )
    .leftJoin(
      workoutSets,
      and(eq(workoutSets.workoutExerciseId, workoutExercises.id), isNull(workoutSets.deletedAt)),
    )
    .where(
      and(
        eq(workouts.userId, userId),
        isNull(workouts.deletedAt),
        isNotNull(workouts.finishedAt),
        lt(workouts.startedAt, to),
      ),
    );

  const customIds = [...new Set(rows.map((row) => row.exerciseId).filter((id): id is string => !!id && !libraryById().has(id)))];
  const custom = new Map<string, ExerciseInfo>();
  if (customIds.length > 0) {
    const found = await db
      .select({ id: exercises.id, name: exercises.name, primaryMuscle: exercises.primaryMuscle, trackingType: exercises.trackingType })
      .from(exercises)
      .where(and(eq(exercises.userId, userId), inArray(exercises.id, customIds)));
    for (const exercise of found) {
      custom.set(exercise.id, {
        name: exercise.name,
        primaryMuscle: exercise.primaryMuscle as MuscleGroup,
        trackingType: exercise.trackingType as TrackingType,
      });
    }
  }

  const byWorkout = new Map<string, ReportWorkoutRow>();
  for (const row of rows) {
    let workout = byWorkout.get(row.workoutId);
    if (!workout) {
      workout = { id: row.workoutId, name: row.name, startedAt: row.startedAt, durationSeconds: row.durationSeconds, sets: [] };
      byWorkout.set(row.workoutId, workout);
    }
    if (!row.exerciseId || row.setType === null || row.isCompleted === null) continue;

    const info = libraryById().get(row.exerciseId) ?? custom.get(row.exerciseId);
    workout.sets.push({
      exerciseId: row.exerciseId,
      exerciseName: info?.name ?? 'Exercise',
      primaryMuscle: info?.primaryMuscle ?? null,
      trackingType: info?.trackingType ?? 'weight_reps',
      setType: row.setType as SetType,
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
export async function latestBodyweightKg(userId: string): Promise<number | undefined> {
  const [row] = await db
    .select({ value: bodyMeasurements.value })
    .from(bodyMeasurements)
    .where(and(eq(bodyMeasurements.userId, userId), eq(bodyMeasurements.kind, 'bodyweight'), isNull(bodyMeasurements.deletedAt)))
    .orderBy(desc(bodyMeasurements.measuredAt))
    .limit(1);
  return row?.value;
}

export async function firstName(userId: string): Promise<string | null> {
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return row?.name.trim().split(/\s+/)[0] || null;
}

/** The routine the app's Up next card would suggest, by name, or null. */
export async function nextRoutineName(userId: string, now: number): Promise<string | null> {
  const list = await db
    .select({ id: routines.id, name: routines.name, lastPerformedAt: routines.lastPerformedAt })
    .from(routines)
    .where(and(eq(routines.userId, userId), isNull(routines.deletedAt)));
  if (list.length < 2) return null;

  const performed = await db
    .select({ routineId: workouts.routineId, startedAt: workouts.startedAt })
    .from(workouts)
    .where(and(eq(workouts.userId, userId), isNull(workouts.deletedAt), isNotNull(workouts.finishedAt)))
    .orderBy(desc(workouts.startedAt))
    .limit(40);

  const suggestion = suggestNextRoutine({ routines: list, sessions: performed, now });
  return suggestion ? (list.find((routine) => routine.id === suggestion.routineId)?.name ?? null) : null;
}
