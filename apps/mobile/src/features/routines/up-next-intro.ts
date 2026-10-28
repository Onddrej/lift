/**
 * What the "Up next" card remembers between visits: that it was put away for
 * today, and the coach's line about today's session.
 *
 * Both are keyed on the routine and the calendar day. A dismissal is "not
 * today", not "never": the card is the fastest way into a session, and hiding
 * it for good on one tap would cost the user the feature without them noticing
 * they had turned it off. And a new routine coming up, or tomorrow arriving,
 * is a new question the card should be allowed to ask again.
 *
 * The intro is written once per key and kept. Home is opened many times a day,
 * and a request per visit would spend the user's money repeating one sentence.
 * Stored in the `settings` key-value table under its own key, beside the
 * settings blob rather than inside it: none of this is a preference.
 */

import {
  dayKey,
  formatWeight,
  isWorkingSet,
  UP_NEXT_BRIEF,
  type WeightUnit,
} from '@lift/shared';
import { eq } from 'drizzle-orm';
import { useCallback, useEffect, useState } from 'react';

import { db } from '@/db/client';
import { settings as settingsTable, type RoutineSet, type WorkoutSet } from '@/db/schema';
import { loadAiConfig, streamCompletion } from '@/features/ai/client';
import { getPreviousPerformance } from '@/features/workouts/repository';

import type { RoutineDetail } from './repository';

const STORE_KEY = 'up_next_card';

/** Two short sentences. Room to spare for a model that thinks out loud first. */
const MAX_OUTPUT_TOKENS = 300;

interface Stored {
  /** The `routineId:day` the card was dismissed for. */
  dismissed: string | null;
  intro: { key: string; text: string } | null;
}

const EMPTY: Stored = { dismissed: null, intro: null };

let cache: Stored | null = null;

async function read(): Promise<Stored> {
  if (cache) return cache;
  try {
    const [row] = await db
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, STORE_KEY))
      .limit(1);
    cache = row ? { ...EMPTY, ...(JSON.parse(row.value) as Partial<Stored>) } : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

async function write(patch: Partial<Stored>): Promise<void> {
  const next = { ...(await read()), ...patch };
  cache = next;
  const value = JSON.stringify(next);
  await db
    .insert(settingsTable)
    .values({ key: STORE_KEY, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: Date.now() } });
}

/** One routine, one day. */
export function upNextKey(routineId: string, now: number): string {
  return `${routineId}:${dayKey(new Date(now))}`;
}

/**
 * Whether the card for `key` was put away, and the call that puts it away.
 *
 * Null while the stored answer is still being read, so the card can wait
 * rather than flash in and vanish.
 */
export function useUpNextDismissal(key: string | null): {
  dismissed: boolean | null;
  dismiss: () => void;
} {
  const [dismissedKey, setDismissedKey] = useState<string | null | undefined>(cache?.dismissed);

  useEffect(() => {
    let live = true;
    void read().then((stored) => {
      if (live) setDismissedKey(stored.dismissed);
    });
    return () => {
      live = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    if (!key) return;
    setDismissedKey(key);
    void write({ dismissed: key });
  }, [key]);

  return { dismissed: dismissedKey === undefined ? null : dismissedKey === key, dismiss };
}

/** One request per key at a time, however many times Home mounts the card. */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * The coach's line about today's session, or null.
 *
 * Null with the AI coach off, with no key, while nothing has arrived yet, and
 * after a failure. Every one of those renders as absence: the card is complete
 * without it, and an error on the way into the gym is noise about a feature
 * the user did not ask to use just then.
 */
export function useUpNextIntro(
  key: string | null,
  detail: RoutineDetail | null,
  reason: string,
  unit: WeightUnit,
): string | null {
  // Paired with its key, so a new routine never shows the last one's line.
  const [intro, setIntro] = useState<{ key: string; text: string } | null>(null);

  useEffect(() => {
    if (!key || !detail) return;
    let live = true;

    void (async () => {
      const stored = await read();
      if (stored.intro?.key === key) {
        if (live) setIntro(stored.intro);
        return;
      }

      const config = await loadAiConfig();
      if (!config || !live) return;

      let request = inFlight.get(key);
      if (!request) {
        request = (async () => {
          try {
            const document = await describeSession(detail, reason, unit);
            const answer = (
              await streamCompletion(
                config,
                {
                  system: UP_NEXT_BRIEF,
                  messages: [{ role: 'user', content: document }],
                  maxOutputTokens: MAX_OUTPUT_TOKENS,
                },
                { onDelta: () => {} },
              )
            ).trim();
            if (!answer) return null;
            await write({ intro: { key, text: answer } });
            return answer;
          } catch {
            return null;
          } finally {
            inFlight.delete(key);
          }
        })();
        inFlight.set(key, request);
      }

      const answer = await request;
      if (live && answer) setIntro({ key, text: answer });
    })();

    return () => {
      live = false;
    };
  }, [key, detail, reason, unit]);

  return intro && intro.key === key ? intro.text : null;
}

/** The routine, its lifts, and what each one did last time, as text for the model. */
async function describeSession(
  detail: RoutineDetail,
  reason: string,
  unit: WeightUnit,
): Promise<string> {
  const lines = [`Routine: ${detail.routine.name}`, `Why it is next: ${reason}`, '', 'Lifts, in order:'];

  for (const { exercise, sets } of detail.exercises) {
    const previous = await getPreviousPerformance(exercise.id);
    const last = previous.sets
      .filter((set) => set.isCompleted && isWorkingSet(set.setType))
      .map((set) => describeSet(set, unit))
      .filter((text): text is string => text !== null);

    let line = `- ${exercise.name}: ${describeTarget(sets)}.`;
    line += last.length > 0 ? ` Last time: ${last.join(', ')}.` : ' Not trained before.';
    if (previous.note) line += ` Their note: "${previous.note}"`;
    lines.push(line);
  }

  return lines.join('\n');
}

function describeTarget(sets: readonly RoutineSet[]): string {
  const working = sets.filter((set) => isWorkingSet(set.setType));
  const reps = working.map((set) => set.targetReps).filter((value): value is number => value != null);
  if (reps.length === 0) return `${working.length} working sets`;
  return `${working.length} working sets of ${[...new Set(reps)].join('/')} reps`;
}

function describeSet(set: WorkoutSet, unit: WeightUnit): string | null {
  if (set.reps == null) return null;
  const effort = set.rpe != null ? ` at effort ${set.rpe}/10` : '';
  return set.weightKg != null && set.weightKg > 0
    ? `${formatWeight(set.weightKg, unit)} × ${set.reps}${effort}`
    : `${set.reps} reps${effort}`;
}
