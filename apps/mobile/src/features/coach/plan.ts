/**
 * A plan the coach wrote, made into something the routine screens can run.
 *
 * Three steps, and the order matters. Resolve first, so the card can show which
 * library exercise each name landed on before anything is written. Describe the
 * changes next, so "update Push A" is a list of sentences the user reads and
 * agrees to, never a surprise. Only then write, through the same writers the
 * routine editor and the share import use.
 */

import {
  formatWeight,
  fromDisplayWeight,
  type CoachPlan,
  type CoachPlanExercise,
  type WeightUnit,
} from '@lift/shared';
import { isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { routines } from '@/db/schema';
import {
  createRoutineFromPrescription,
  getRoutineDetail,
  replaceRoutineContents,
  type PrescribedExercise,
  type RoutineDetail,
} from '@/features/routines/repository';

import { resolveExercise, type CoachExerciseRow } from './exercise-lookup';

export interface ResolvedPlanExercise {
  planned: CoachPlanExercise;
  /** Null when no exercise in the library matches the name the coach wrote. */
  exercise: CoachExerciseRow | null;
}

export interface ResolvedPlan {
  plan: CoachPlan;
  exercises: ResolvedPlanExercise[];
  /** The routine the plan revises, when it named one that exists. */
  target: RoutineDetail | null;
}

export async function resolvePlan(plan: CoachPlan): Promise<ResolvedPlan> {
  const [exercises, target] = await Promise.all([
    Promise.all(
      plan.exercises.map(async (planned) => ({ planned, exercise: await resolveExercise(planned.exercise) })),
    ),
    plan.routine ? findRoutine(plan.routine) : Promise.resolve(null),
  ]);

  return { plan, exercises, target };
}

/** Case and spacing do not make a different routine. */
async function findRoutine(name: string): Promise<RoutineDetail | null> {
  const rows = await db
    .select({ id: routines.id, name: routines.name })
    .from(routines)
    .where(isNull(routines.deletedAt));

  const wanted = normalise(name);
  const match = rows.find((row) => normalise(row.name) === wanted);
  return match ? ((await getRoutineDetail(match.id)) ?? null) : null;
}

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** What a plan writes. Exercises the library could not match are left out. */
export function prescriptionOf(resolved: ResolvedPlan, unit: WeightUnit): PrescribedExercise[] {
  return resolved.exercises.flatMap(({ planned, exercise }, index) => {
    if (!exercise) return [];

    return [
      {
        exerciseId: exercise.id,
        position: index + 1,
        notes: notesFor(planned),
        restSeconds: planned.restSeconds,
        supersetGroup: null,
        sets: Array.from({ length: planned.sets }, () => ({
          setType: 'normal' as const,
          // The bottom of a range is the target, and the range itself goes in
          // the note: the double-progression reading of "8 to 10", where the
          // load goes up once every set reaches the top.
          targetReps: planned.repsLow,
          targetWeightKg: planned.weight !== null ? fromDisplayWeight(planned.weight, unit) : null,
          targetDurationSeconds: null,
          targetDistanceKm: null,
          targetRpe: planned.rpe,
        })),
      },
    ];
  });
}

/**
 * The part of a plan a routine has no column for.
 *
 * A rep range and the coach's cue, kept as the exercise note so they are on
 * screen mid-set, which is when they are needed.
 */
function notesFor(planned: CoachPlanExercise): string | null {
  const parts: string[] = [];
  if (planned.repsLow !== null && planned.repsHigh !== null && planned.repsHigh > planned.repsLow) {
    parts.push(`${planned.repsLow} to ${planned.repsHigh} reps.`);
  }
  if (planned.note) parts.push(planned.note);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * What updating the target routine would change, as sentences.
 *
 * Compared by exercise, in order, the way the routine reads. Only differences
 * are listed: a routine where one lift gains a set should say exactly that.
 */
export function describePlanChanges(resolved: ResolvedPlan, unit: WeightUnit): string[] {
  if (!resolved.target) return [];

  const before = resolved.target.exercises.map((entry) => ({
    id: entry.exercise.id,
    name: entry.exercise.name,
    summary: summarise(
      entry.sets.length,
      entry.sets[0]?.targetReps ?? null,
      entry.sets[0]?.targetWeightKg ?? null,
      unit,
    ),
  }));

  const after = resolved.exercises.flatMap(({ planned, exercise }) =>
    exercise
      ? [
          {
            id: exercise.id,
            name: exercise.name,
            summary: summarise(
              planned.sets,
              planned.repsLow,
              planned.weight !== null ? fromDisplayWeight(planned.weight, unit) : null,
              unit,
            ),
          },
        ]
      : [],
  );

  const changes: string[] = [];
  const remaining = [...before];

  for (const slot of after) {
    const index = remaining.findIndex((entry) => entry.id === slot.id);
    if (index === -1) {
      changes.push(`Add ${slot.name}: ${slot.summary}.`);
      continue;
    }
    const [was] = remaining.splice(index, 1);
    if (was && was.summary !== slot.summary) changes.push(`${slot.name}: ${was.summary} becomes ${slot.summary}.`);
  }

  for (const slot of remaining) changes.push(`Remove ${slot.name}.`);

  if (changes.length === 0 && before.some((slot, index) => slot.id !== after[index]?.id)) {
    changes.push('Reorder the exercises.');
  }

  return changes;
}

function summarise(sets: number, reps: number | null, weightKg: number | null, unit: WeightUnit): string {
  const base = `${sets} × ${reps ?? '?'}`;
  return weightKg === null ? base : `${base} @ ${formatWeight(weightKg, unit)}`;
}

export async function savePlanAsRoutine(resolved: ResolvedPlan, unit: WeightUnit, name: string): Promise<string> {
  const routine = await createRoutineFromPrescription({
    name: name.trim() || resolved.plan.title,
    notes: resolved.plan.notes,
    exercises: prescriptionOf(resolved, unit),
  });
  return routine.id;
}

export async function applyPlanToRoutine(resolved: ResolvedPlan, unit: WeightUnit): Promise<string> {
  if (!resolved.target) throw new Error('This plan does not name one of your routines');
  await replaceRoutineContents(resolved.target.routine.id, prescriptionOf(resolved, unit));
  return resolved.target.routine.id;
}
