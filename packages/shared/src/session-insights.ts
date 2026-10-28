/**
 * The finish screen's verdict, arrived at by arithmetic.
 *
 * A finished session already has every number it needs to say whether it went
 * well: each lift against the last time it was trained, the effort the sets
 * were rated at, and the volume against the last run of the same routine. What
 * the screen lacked was a reading of them. The totals said how much work it was
 * and nothing said whether it was progress.
 *
 * Nothing here needs a model. The language-model card on the same screen is
 * handed the same figures and told not to recompute them; this file is what
 * the screen shows with that card switched off, which is the default.
 *
 * Pure and unit-agnostic: kilograms in, and the only formatted text out is the
 * headline, which carries no units at all, plus `describeNextTime`, which is
 * given the unit to print in.
 */

import { summarizeSets, type AnalyticsContext, type OneRepMaxFormula, type SetLike } from './calculations.ts';
import type { Suggestion } from './progression.ts';
import { isWorkingSet, type TrackingType, type WeightUnit } from './types.ts';
import { formatWeight } from './units.ts';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface InsightSet extends SetLike {
  rpe?: number | null;
}

export interface ExerciseInsightInput {
  /** The session's link id for this exercise, echoed back so rows can key on it. */
  id: string;
  name: string;
  trackingType: TrackingType;
  today: readonly InsightSet[];
  /**
   * The last session that trained this exercise, or null when this was the
   * first. An empty array is treated the same as null: a session with no
   * completed working sets in it is not a baseline.
   */
  lastTime: readonly InsightSet[] | null;
}

export interface SessionInsightInput {
  exercises: readonly ExerciseInsightInput[];
  /** Records set in this session, counted however the screen counts them. */
  recordCount: number;
  volumeKg: number;
  /**
   * The total volume of the last finished run of the same routine, or null when
   * the session was not started from one or the routine has never been run.
   */
  previousRoutineVolumeKg: number | null;
  bodyweightKg?: number | null;
  formula?: OneRepMaxFormula;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/**
 * One lift's movement in a word.
 *
 * `new` is a first session, which has nothing to be compared with and is the
 * baseline the next one is measured from. `logged` is a lift that was done but
 * has no measure this file is willing to compare, such as assisted work with no
 * bodyweight on file, where the direction of "more" is unknowable.
 */
export type LiftVerdict = 'up' | 'steady' | 'down' | 'new' | 'logged';

/** What the number being compared is, so the screen can name it plainly. */
export type LiftMeasure = 'max' | 'reps' | 'time' | 'distance' | 'load';

export type EffortLabel = 'easy' | 'solid' | 'hard' | 'all-out';

export interface ExerciseInsight {
  id: string;
  name: string;
  verdict: LiftVerdict;
  measure: LiftMeasure | null;
  /** The measure today, in its own unit: kg, reps, seconds or km. */
  value: number | null;
  previous: number | null;
  /**
   * Percent change on last time, for the measures where a percent is the honest
   * way to put it. Null for reps, where "+2 reps" says it better than "+20%".
   */
  changePercent: number | null;
  /** The absolute change, in the measure's unit. */
  change: number | null;
  workingSets: number;
  /** Mean RPE over the rated working sets, when at least half were rated. */
  averageRpe: number | null;
  effort: EffortLabel | null;
}

/** The session's overall reading, from best to worst. */
export type SessionTone = 'great' | 'good' | 'steady' | 'tough' | 'baseline';

export interface SessionInsights {
  tone: SessionTone;
  /** Two or three words: "Strong session". */
  headline: string;
  /** One short line of counts: "2 lifts up, 1 steady, 1 record". */
  tally: string;
  /** One plain sentence naming the lift that mattered most, or null. */
  detail: string | null;
  counts: Record<LiftVerdict, number>;
  /** Volume against the last run of the same routine, in percent. */
  volumeChangePercent: number | null;
  averageRpe: number | null;
  effort: EffortLabel | null;
  exercises: ExerciseInsight[];
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * How far an estimated max has to move to count as moving.
 *
 * One percent is a 2.5 kg plate on a 250 kg estimate and a rep or so on a light
 * accessory. Below it the change is inside what the formula invents from a
 * slightly different rep count, and calling it progress would teach the user to
 * ignore the word.
 */
const STEADY_PERCENT = 1;

/** Effort is reported only when at least this share of working sets were rated. */
const RATED_SHARE = 0.5;

// ---------------------------------------------------------------------------
// Per exercise
// ---------------------------------------------------------------------------

export function analyzeExercise(
  input: ExerciseInsightInput,
  context: { bodyweightKg?: number | null; formula?: OneRepMaxFormula } = {},
): ExerciseInsight {
  const today = working(input.today);
  const last = input.lastTime ? working(input.lastTime) : [];

  const measure = measureFor(input.trackingType, context.bodyweightKg ?? null);
  const effortRead = readEffort(today);

  const base = {
    id: input.id,
    name: input.name,
    workingSets: today.length,
    averageRpe: effortRead,
    effort: effortRead === null ? null : effortLabel(effortRead),
  };

  if (measure === null || today.length === 0) {
    return { ...base, verdict: 'logged', measure, value: null, previous: null, change: null, changePercent: null };
  }

  const ctx: AnalyticsContext = {
    trackingType: input.trackingType,
    bodyweightKg: context.bodyweightKg ?? undefined,
    formula: context.formula,
  };

  const value = readMeasure(today, measure, ctx);

  if (last.length === 0) {
    return { ...base, verdict: 'new', measure, value, previous: null, change: null, changePercent: null };
  }

  const previous = readMeasure(last, measure, ctx);
  const change = value - previous;
  const changePercent = measure === 'reps' || previous <= 0 ? null : (change / previous) * 100;

  return {
    ...base,
    verdict: verdictFor(measure, change, changePercent),
    measure,
    value,
    previous,
    change,
    changePercent,
  };
}

/**
 * What "better" means for a tracking type, or null where it cannot be said.
 *
 * Loaded rep work is compared on estimated max, which folds weight and reps into
 * one number, so 80 kg x 10 after 82.5 kg x 6 reads as the progress it is rather
 * than as a lighter day. Assisted work only has a max when bodyweight is known:
 * without it, less assistance and more assistance cannot be told apart.
 */
function measureFor(trackingType: TrackingType, bodyweightKg: number | null): LiftMeasure | null {
  switch (trackingType) {
    case 'weight_reps':
    case 'weighted_bodyweight':
      return 'max';
    case 'assisted_bodyweight':
      return bodyweightKg !== null && bodyweightKg > 0 ? 'max' : null;
    case 'bodyweight_reps':
    case 'reps_only':
      return 'reps';
    case 'duration':
      return 'time';
    case 'distance_duration':
      return 'distance';
    case 'weight_distance':
      return 'load';
  }
}

function readMeasure(sets: readonly InsightSet[], measure: LiftMeasure, ctx: AnalyticsContext): number {
  const summary = summarizeSets(sets, ctx);
  switch (measure) {
    case 'max':
      return summary.bestOneRepMaxKg;
    case 'reps':
      return summary.bestReps;
    case 'time':
      return summary.longestDurationSeconds;
    case 'distance':
      return summary.farthestDistanceKm;
    case 'load':
      return summary.heaviestKg;
  }
}

function verdictFor(measure: LiftMeasure, change: number, changePercent: number | null): LiftVerdict {
  // A rep is a whole unit and is never noise: one more push-up is one more.
  if (measure === 'reps') return change > 0 ? 'up' : change < 0 ? 'down' : 'steady';
  if (changePercent === null) return change > 0 ? 'up' : 'steady';
  if (changePercent >= STEADY_PERCENT) return 'up';
  if (changePercent <= -STEADY_PERCENT) return 'down';
  return 'steady';
}

function working(sets: readonly InsightSet[]): InsightSet[] {
  return sets.filter((set) => set.isCompleted && isWorkingSet(set.setType));
}

function readEffort(sets: readonly InsightSet[]): number | null {
  const rated = sets.map((set) => set.rpe).filter((rpe): rpe is number => typeof rpe === 'number' && rpe > 0);
  if (rated.length === 0 || rated.length < sets.length * RATED_SHARE) return null;
  return Math.round((rated.reduce((sum, rpe) => sum + rpe, 0) / rated.length) * 10) / 10;
}

/**
 * RPE in words. The bands follow reps in reserve: three or more left is easy,
 * one or two is the working range most programmes ask for, under one is hard,
 * and a 10 is nothing left at all.
 */
export function effortLabel(rpe: number): EffortLabel {
  if (rpe >= 9.5) return 'all-out';
  if (rpe >= 8.5) return 'hard';
  if (rpe >= 7) return 'solid';
  return 'easy';
}

export const EFFORT_LABELS: Record<EffortLabel, string> = {
  easy: 'Easy',
  solid: 'Solid',
  hard: 'Hard',
  'all-out': 'All out',
};

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

export function analyzeSession(input: SessionInsightInput): SessionInsights {
  const context = { bodyweightKg: input.bodyweightKg, formula: input.formula };
  const exercises = input.exercises
    .map((exercise) => analyzeExercise(exercise, context))
    .filter((exercise) => exercise.workingSets > 0);

  const counts: Record<LiftVerdict, number> = { up: 0, steady: 0, down: 0, new: 0, logged: 0 };
  for (const exercise of exercises) counts[exercise.verdict] += 1;

  const tone = toneFor(counts, input.recordCount);

  const volumeChangePercent =
    input.previousRoutineVolumeKg !== null && input.previousRoutineVolumeKg > 0 && input.volumeKg > 0
      ? ((input.volumeKg - input.previousRoutineVolumeKg) / input.previousRoutineVolumeKg) * 100
      : null;

  const averageRpe = sessionEffort(input.exercises);

  return {
    tone,
    headline: HEADLINES[tone],
    tally: tallyLine(counts, input.recordCount),
    detail: detailLine(tone, exercises),
    counts,
    volumeChangePercent,
    averageRpe,
    effort: averageRpe === null ? null : effortLabel(averageRpe),
    exercises,
  };
}

const HEADLINES: Record<SessionTone, string> = {
  great: 'Strong session',
  good: 'Good session',
  steady: 'Steady session',
  tough: 'Lighter session',
  baseline: 'Baseline set',
};

/**
 * The overall reading.
 *
 * A record outranks everything: a session that beat a best is a strong one even
 * if an accessory slipped. Otherwise it is the balance of lifts that moved
 * against lifts that slipped, and a session with nothing to compare against is
 * a baseline, which is a fact rather than a grade.
 */
function toneFor(counts: Record<LiftVerdict, number>, records: number): SessionTone {
  const compared = counts.up + counts.steady + counts.down;
  if (compared === 0) return records > 0 ? 'great' : 'baseline';
  if (records > 0 || (counts.up > 0 && counts.down === 0)) return 'great';
  if (counts.up > counts.down) return 'good';
  if (counts.down > counts.up) return 'tough';
  return 'steady';
}

function tallyLine(counts: Record<LiftVerdict, number>, records: number): string {
  const parts: string[] = [];
  if (counts.up > 0) parts.push(`${counts.up} ${counts.up === 1 ? 'lift' : 'lifts'} up`);
  if (counts.steady > 0) parts.push(`${counts.steady} steady`);
  if (counts.down > 0) parts.push(`${counts.down} down`);
  if (counts.new > 0) parts.push(`${counts.new} new`);
  if (records > 0) parts.push(`${records} ${records === 1 ? 'record' : 'records'}`);
  return parts.length > 0 ? parts.join(', ') : 'Nothing to compare yet';
}

/**
 * One sentence about the lift that mattered most.
 *
 * The biggest mover on a good day, the biggest slip on a lighter one, so the
 * line always names something the user can act on. A lighter session is framed
 * as the single data point it is: one down day is not a trend, and saying so is
 * more useful than a frown.
 */
function detailLine(tone: SessionTone, exercises: readonly ExerciseInsight[]): string | null {
  if (tone === 'baseline') return 'First time logging these lifts here. Next session is measured against this one.';

  const ranked = exercises.filter((exercise) => exercise.change !== null);
  const best = maxBy(ranked.filter((exercise) => exercise.verdict === 'up'), score);
  const worst = maxBy(ranked.filter((exercise) => exercise.verdict === 'down'), (exercise) => -score(exercise));

  if (tone === 'tough' && worst) {
    return `${worst.name} slipped ${describeChange(worst)}. One session is not a trend; repeat the weight next time.`;
  }
  if (best) return `${best.name} led the way, ${describeChange(best)}.`;
  if (tone === 'steady') return 'Matched last time across the board. Next time, aim to add a rep somewhere.';
  return null;
}

function score(exercise: ExerciseInsight): number {
  return exercise.changePercent ?? (exercise.change ?? 0) * 5;
}

/** "est. max up 4%", "2 more reps". Units are the screen's job; this avoids them. */
export function describeChange(exercise: ExerciseInsight): string {
  const change = exercise.change ?? 0;
  if (exercise.measure === 'reps') {
    const count = Math.abs(change);
    const word = count === 1 ? 'rep' : 'reps';
    return change >= 0 ? `${count} more ${word}` : `${count} fewer ${word}`;
  }
  const percent = Math.abs(Math.round(exercise.changePercent ?? 0));
  const direction = change >= 0 ? 'up' : 'down';
  return `${MEASURE_NAMES[exercise.measure ?? 'max']} ${direction} ${percent}%`;
}

export const MEASURE_NAMES: Record<LiftMeasure, string> = {
  max: 'est. max',
  reps: 'best reps',
  time: 'best time',
  distance: 'distance',
  load: 'top load',
};

function sessionEffort(exercises: readonly ExerciseInsightInput[]): number | null {
  return readEffort(exercises.flatMap((exercise) => working(exercise.today)));
}

function maxBy<T>(items: readonly T[], key: (item: T) => number): T | null {
  let best: T | null = null;
  let bestKey = -Infinity;
  for (const item of items) {
    const value = key(item);
    if (value > bestKey) {
      best = item;
      bestKey = value;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Next time
// ---------------------------------------------------------------------------

/**
 * A progression suggestion as one line: "3 x 8 at 82.5 kg", "82.5 kg x 8, 80 kg x 8".
 *
 * Identical sets collapse to "sets x reps at load", which is how a programme is
 * written on a whiteboard. Sets that differ are listed, at most three, because
 * the screen has one line for this.
 */
export function describeNextTime(suggestion: Suggestion, unit: WeightUnit): string | null {
  const sets = suggestion.sets.filter((set) => set.weightKg !== null || set.reps !== null);
  if (sets.length === 0) return null;

  const piece = (set: (typeof sets)[number]): string => {
    const load = set.weightKg !== null && set.weightKg > 0 ? formatWeight(set.weightKg, unit) : null;
    const reps = set.reps !== null ? `${set.reps} ${set.reps === 1 ? 'rep' : 'reps'}` : null;
    return [load, reps].filter(Boolean).join(' x ');
  };

  const first = sets[0]!;
  const uniform = sets.every((set) => set.weightKg === first.weightKg && set.reps === first.reps);

  if (uniform) {
    if (first.reps === null) return `${sets.length} x ${piece(first)}`;
    const load = first.weightKg !== null && first.weightKg > 0 ? ` at ${formatWeight(first.weightKg, unit)}` : '';
    return `${sets.length} x ${first.reps}${load}`;
  }

  const listed = sets.slice(0, 3).map(piece).join(', ');
  return sets.length > 3 ? `${listed}, +${sets.length - 3} more` : listed;
}

// ---------------------------------------------------------------------------
// The model's debrief
// ---------------------------------------------------------------------------

export type DebriefLabel = 'Went well' | 'Watch' | 'Next time';

export interface Debrief {
  headline: string;
  lines: { label: DebriefLabel; text: string }[];
}

const DEBRIEF_LABELS: Record<string, DebriefLabel | 'Headline'> = {
  headline: 'Headline',
  'went well': 'Went well',
  watch: 'Watch',
  'next time': 'Next time',
};

/**
 * Reads the labelled debrief `SESSION_BRIEF` asks for, or returns null.
 *
 * Null is the ordinary outcome for anything else: a summary stored before the
 * brief changed is a paragraph, and a model that ignored the format wrote one
 * too. The card prints those as they are rather than guessing at structure.
 * Markdown bold around a label is tolerated, because some models add it to
 * anything that looks like a heading.
 *
 * `partial` is for an answer still streaming in: its last line may be a label
 * cut off halfway, which is skipped rather than read as a broken shape, so the
 * card does not flip to a paragraph and back once per line.
 */
export function parseDebrief(text: string, options: { partial?: boolean } = {}): Debrief | null {
  let headline: string | null = null;
  const lines: Debrief['lines'] = [];
  const rows = text.split('\n');

  for (const [index, raw] of rows.entries()) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const match = /^[*_\s-]*(headline|went well|watch|next time)[*_\s]*:[*_\s]*(.*)$/i.exec(line);
    if (!match) {
      if (options.partial && index === rows.length - 1) break;
      return null;
    }

    const label = DEBRIEF_LABELS[match[1]!.toLowerCase()]!;
    const body = match[2]!.replace(/[*_]+$/, '').trim();
    if (body.length === 0) continue;

    if (label === 'Headline') headline = body;
    else lines.push({ label, text: body });
  }

  return headline !== null && lines.length > 0 ? { headline, lines } : null;
}
