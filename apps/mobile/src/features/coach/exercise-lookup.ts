/**
 * Turning a name the coach wrote into an exercise in this database.
 *
 * The model names exercises in prose, and every card and lookup has to land on
 * a row. The import matcher already solves the hard part of that (equipment
 * words, word order, "lat" for "lateral"), so this is the policy around it:
 * the lifts this person has actually trained are tried first. "Bench Press"
 * from someone who has logged "Bench Press (Barbell)" fifty times means that
 * row, not whichever of the library's sixty bench variants sorts first.
 */

import type { Equipment, MuscleGroup, TrackingType } from '@lift/shared';
import { buildTrainingIndex, filterExercises, type ExerciseUsage } from '@lift/shared/exercises';
import { buildImportMatchIndex, matchImportedName, type ImportMatchIndex } from '@lift/shared/import';
import { isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { exercises } from '@/db/schema';
import { trainingHistoryQuery } from '@/features/exercises/repository';

export interface CoachExerciseRow {
  id: string;
  name: string;
  equipment: Equipment;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  trackingType: TrackingType;
  isCustom: boolean;
  isArchived: boolean;
}

interface Catalog {
  rows: CoachExerciseRow[];
  byId: Map<string, CoachExerciseRow>;
  usage: Map<string, ExerciseUsage>;
  trained: ImportMatchIndex;
  library: ImportMatchIndex;
}

/**
 * How long one read of the catalog is reused.
 *
 * A reply can name a dozen exercises across its cards and lookups, and each is
 * resolved separately; reading 6,800 rows per name would be most of the cost
 * of drawing a plan. Short enough that an exercise created a minute ago is
 * found on the next reply.
 */
const CATALOG_TTL_MS = 60_000;

let cached: { at: number; catalog: Promise<Catalog> } | null = null;

function loadCatalog(): Promise<Catalog> {
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.catalog;

  const catalog = (async (): Promise<Catalog> => {
    const [raw, history] = await Promise.all([
      db
        .select({
          id: exercises.id,
          name: exercises.name,
          equipment: exercises.equipment,
          primaryMuscle: exercises.primaryMuscle,
          secondaryMuscles: exercises.secondaryMuscles,
          trackingType: exercises.trackingType,
          isCustom: exercises.isCustom,
          isArchived: exercises.isArchived,
        })
        .from(exercises)
        .where(isNull(exercises.deletedAt)),
      trainingHistoryQuery(),
    ]);

    const rows = raw.map((row) => ({
      ...row,
      secondaryMuscles: Array.isArray(row.secondaryMuscles) ? row.secondaryMuscles : [],
    }));
    const usage = new Map(buildTrainingIndex(history).usage);

    return {
      rows,
      byId: new Map(rows.map((row) => [row.id, row])),
      usage,
      trained: buildImportMatchIndex(rows.filter((row) => usage.has(row.id))),
      library: buildImportMatchIndex(rows.filter((row) => !row.isArchived)),
    };
  })();

  cached = { at: Date.now(), catalog };
  // A failed read must not be served for the next minute.
  catalog.catch(() => {
    if (cached?.catalog === catalog) cached = null;
  });

  return catalog;
}

/**
 * The exercise a name most plausibly means, or null.
 *
 * An ambiguous match takes the matcher's first suggestion, which it has already
 * ranked by agreeing equipment. A user can see which exercise a card landed on
 * by its name, and a plan shows every resolved name before it saves anything.
 */
export async function resolveExercise(name: string): Promise<CoachExerciseRow | null> {
  const catalog = await loadCatalog();

  for (const index of [catalog.trained, catalog.library]) {
    const decision = matchImportedName(name, index);
    if (decision.kind === 'hit') return catalog.byId.get(decision.id) ?? null;
    if (decision.kind === 'ask' && decision.suggestions[0]) {
      return catalog.byId.get(decision.suggestions[0].id) ?? null;
    }
  }

  return null;
}

export interface ExerciseSearchHit {
  row: CoachExerciseRow;
  usage: ExerciseUsage | null;
}

/** The picker's own search, trained lifts first. */
export async function searchExercises(query: string, limit = 8): Promise<ExerciseSearchHit[]> {
  const catalog = await loadCatalog();
  return filterExercises(catalog.rows, { search: query }, catalog.usage)
    .slice(0, limit)
    .map((row) => ({ row, usage: catalog.usage.get(row.id) ?? null }));
}
