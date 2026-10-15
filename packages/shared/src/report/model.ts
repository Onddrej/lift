/**
 * A training report: one window of the log, reduced to what a person wants to
 * see about it on a page.
 *
 * Built from plain rows rather than from the app's analytics, because two very
 * different places produce it. The phone builds it from SQLite when someone
 * taps "Export report"; the server builds it from Postgres every Sunday for the
 * Telegram bot. Both hand over the same shape of rows, and both get the same
 * report, which is the point: a PDF that came from the bot and one exported
 * from the app should never disagree about the same week.
 *
 * Pure: no clock, no database, no time zone guessed from the machine it runs
 * on. The server's clock is UTC and its users are not, so the zone is an
 * argument.
 */

import {
  setOneRepMaxKg,
  setVolumeKg,
  type AnalyticsContext,
} from '../calculations.ts';
import {
  isWorkingSet,
  MUSCLE_GROUP_LABELS,
  type MuscleGroup,
  type SetType,
  type TrackingType,
  type WeightUnit,
} from '../types.ts';
import { toDisplayWeight } from '../units.ts';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface ReportSetRow {
  exerciseId: string;
  exerciseName: string;
  primaryMuscle: MuscleGroup | null;
  trackingType: TrackingType;
  setType: SetType;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceKm: number | null;
  isCompleted: boolean;
}

export interface ReportWorkoutRow {
  id: string;
  name: string;
  startedAt: number;
  durationSeconds: number | null;
  sets: ReportSetRow[];
}

export interface ReportInput {
  /** Every finished workout up to `to`. Older ones are what records are measured against. */
  workouts: readonly ReportWorkoutRow[];
  /** Window start, epoch ms, inclusive. */
  from: number;
  /** Window end, epoch ms, exclusive. */
  to: number;
  unit: WeightUnit;
  /** IANA zone the days are counted in. Omitted means the runtime's own. */
  timeZone?: string;
  /** First name, for the cover. */
  athlete?: string | null;
  bodyweightKg?: number;
  /** When it was made, for the footer. */
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface ReportTotals {
  sessions: number;
  volumeKg: number;
  sets: number;
  reps: number;
  minutes: number;
  trainingDays: number;
}

export interface ReportBucket {
  /** "Mon", "14", "W42": short enough to sit under a bar. */
  label: string;
  volumeKg: number;
  sessions: number;
}

export interface ReportLift {
  name: string;
  sets: number;
  volumeKg: number;
  bestOneRepMaxKg: number;
  /** The set that estimate came from, as weight and reps. */
  bestSet: { weightKg: number; reps: number } | null;
}

export interface ReportRecord {
  name: string;
  oneRepMaxKg: number;
  /** The best before this window, or null when this is the first time. */
  previousKg: number | null;
}

export interface ReportMuscle {
  muscle: string;
  sets: number;
}

export interface TrainingReport {
  from: number;
  to: number;
  days: number;
  unit: WeightUnit;
  timeZone?: string;
  athlete: string | null;
  generatedAt: number;
  totals: ReportTotals;
  /** The same totals for the window of equal length just before this one. */
  previous: ReportTotals;
  /** Daily up to two weeks, weekly beyond. */
  buckets: ReportBucket[];
  lifts: ReportLift[];
  records: ReportRecord[];
  muscles: ReportMuscle[];
  /** The longest session, by volume. */
  biggestSession: { name: string; volumeKg: number; startedAt: number } | null;
  highlights: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_LIFTS = 5;
const TOP_MUSCLES = 8;
const TOP_RECORDS = 6;
/** Below this, an estimated max is noise from a warm-up logged as working. */
const RECORD_FLOOR_KG = 1;

export function buildTrainingReport(input: ReportInput): TrainingReport {
  const { from, to, unit, timeZone } = input;
  const length = Math.max(DAY_MS, to - from);

  const inWindow = input.workouts.filter((workout) => workout.startedAt >= from && workout.startedAt < to);
  const before = input.workouts.filter((workout) => workout.startedAt < from);
  const previousWindow = before.filter((workout) => workout.startedAt >= from - length);

  const totals = totalsOf(inWindow, input, timeZone);
  const previous = totalsOf(previousWindow, input, timeZone);

  const lifts = liftsOf(inWindow, input);
  const records = recordsOf(inWindow, before, input);
  const muscles = musclesOf(inWindow);
  const biggestSession = biggestOf(inWindow, input);

  const report: TrainingReport = {
    from,
    to,
    days: Math.round(length / DAY_MS),
    unit,
    ...(timeZone ? { timeZone } : {}),
    athlete: input.athlete?.trim().split(/\s+/)[0] || null,
    generatedAt: input.generatedAt,
    totals,
    previous,
    buckets: bucketsOf(inWindow, input),
    lifts,
    records,
    muscles,
    biggestSession,
    highlights: [],
  };
  report.highlights = highlightsOf(report);
  return report;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function contextOf(set: ReportSetRow, input: ReportInput): AnalyticsContext {
  return {
    trackingType: set.trackingType,
    ...(input.bodyweightKg !== undefined ? { bodyweightKg: input.bodyweightKg } : {}),
  };
}

function working(set: ReportSetRow): boolean {
  return set.isCompleted && isWorkingSet(set.setType);
}

function workoutVolume(workout: ReportWorkoutRow, input: ReportInput): number {
  return workout.sets.reduce((sum, set) => sum + setVolumeKg(set, contextOf(set, input)), 0);
}

function totalsOf(workouts: readonly ReportWorkoutRow[], input: ReportInput, timeZone?: string): ReportTotals {
  const days = new Set<string>();
  const totals: ReportTotals = { sessions: workouts.length, volumeKg: 0, sets: 0, reps: 0, minutes: 0, trainingDays: 0 };

  for (const workout of workouts) {
    days.add(dayKey(workout.startedAt, timeZone));
    totals.minutes += Math.round((workout.durationSeconds ?? 0) / 60);
    for (const set of workout.sets) {
      if (!working(set)) continue;
      totals.sets += 1;
      totals.reps += set.reps ?? 0;
      totals.volumeKg += setVolumeKg(set, contextOf(set, input));
    }
  }

  totals.trainingDays = days.size;
  return totals;
}

function bucketsOf(workouts: readonly ReportWorkoutRow[], input: ReportInput): ReportBucket[] {
  const { from, to, timeZone } = input;
  const days = Math.max(1, Math.round((to - from) / DAY_MS));
  const daily = days <= 14;
  const step = daily ? DAY_MS : 7 * DAY_MS;
  const count = Math.max(1, Math.ceil((to - from) / step));

  const buckets: ReportBucket[] = Array.from({ length: count }, (_, index) => {
    const start = from + index * step;
    return { label: daily ? dayLabel(start, days, timeZone) : weekLabel(start, timeZone), volumeKg: 0, sessions: 0 };
  });

  for (const workout of workouts) {
    const index = Math.min(count - 1, Math.floor((workout.startedAt - from) / step));
    const bucket = buckets[index];
    if (!bucket) continue;
    bucket.sessions += 1;
    bucket.volumeKg += workoutVolume(workout, input);
  }

  return buckets;
}

function liftsOf(workouts: readonly ReportWorkoutRow[], input: ReportInput): ReportLift[] {
  const byExercise = new Map<string, ReportLift>();

  for (const workout of workouts) {
    for (const set of workout.sets) {
      if (!working(set)) continue;
      const ctx = contextOf(set, input);
      const lift = byExercise.get(set.exerciseId) ?? {
        name: set.exerciseName,
        sets: 0,
        volumeKg: 0,
        bestOneRepMaxKg: 0,
        bestSet: null,
      };
      lift.sets += 1;
      lift.volumeKg += setVolumeKg(set, ctx);
      const estimate = setOneRepMaxKg(set, ctx);
      if (estimate > lift.bestOneRepMaxKg) {
        lift.bestOneRepMaxKg = estimate;
        lift.bestSet = { weightKg: set.weightKg ?? 0, reps: set.reps ?? 0 };
      }
      byExercise.set(set.exerciseId, lift);
    }
  }

  return [...byExercise.values()]
    .sort((a, b) => b.volumeKg - a.volumeKg || b.sets - a.sets)
    .slice(0, TOP_LIFTS);
}

function bestEstimates(workouts: readonly ReportWorkoutRow[], input: ReportInput): Map<string, { name: string; kg: number }> {
  const best = new Map<string, { name: string; kg: number }>();
  for (const workout of workouts) {
    for (const set of workout.sets) {
      if (!working(set)) continue;
      const kg = setOneRepMaxKg(set, contextOf(set, input));
      const current = best.get(set.exerciseId);
      if (!current || kg > current.kg) best.set(set.exerciseId, { name: set.exerciseName, kg });
    }
  }
  return best;
}

/**
 * Lifts whose best estimated max in the window beats everything before it.
 *
 * A lift trained for the first time counts only when there is history at all:
 * a brand new log would otherwise report every exercise in it as a record,
 * which is true and worthless.
 */
function recordsOf(
  window: readonly ReportWorkoutRow[],
  before: readonly ReportWorkoutRow[],
  input: ReportInput,
): ReportRecord[] {
  const now = bestEstimates(window, input);
  const then = bestEstimates(before, input);
  const records: ReportRecord[] = [];

  for (const [id, current] of now) {
    if (current.kg < RECORD_FLOOR_KG) continue;
    const previous = then.get(id);
    if (previous && current.kg <= previous.kg + 0.01) continue;
    if (!previous && before.length === 0) continue;
    records.push({ name: current.name, oneRepMaxKg: current.kg, previousKg: previous?.kg ?? null });
  }

  return records
    .sort((a, b) => gain(b) - gain(a))
    .slice(0, TOP_RECORDS);
}

function gain(record: ReportRecord): number {
  return record.previousKg === null ? 0 : record.oneRepMaxKg - record.previousKg;
}

function musclesOf(workouts: readonly ReportWorkoutRow[]): ReportMuscle[] {
  const counts = new Map<string, number>();
  for (const workout of workouts) {
    for (const set of workout.sets) {
      if (!working(set) || !set.primaryMuscle) continue;
      const label = MUSCLE_GROUP_LABELS[set.primaryMuscle] ?? set.primaryMuscle;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([muscle, sets]) => ({ muscle, sets }))
    .sort((a, b) => b.sets - a.sets)
    .slice(0, TOP_MUSCLES);
}

function biggestOf(workouts: readonly ReportWorkoutRow[], input: ReportInput): TrainingReport['biggestSession'] {
  let best: TrainingReport['biggestSession'] = null;
  for (const workout of workouts) {
    const volumeKg = workoutVolume(workout, input);
    if (!best || volumeKg > best.volumeKg) best = { name: workout.name, volumeKg, startedAt: workout.startedAt };
  }
  return best && best.volumeKg > 0 ? best : null;
}

/**
 * Three or four plain sentences about the window, worked out from the numbers.
 *
 * No model involved: these are comparisons the report already holds, said the
 * way a coach would say them.
 */
function highlightsOf(report: TrainingReport): string[] {
  const { totals, previous, unit } = report;
  const lines: string[] = [];

  if (totals.sessions === 0) {
    lines.push('No sessions logged in this window. One short workout restarts the streak.');
    return lines;
  }

  const sessionWord = totals.sessions === 1 ? 'session' : 'sessions';
  if (previous.sessions > 0) {
    const change = percentChange(totals.volumeKg, previous.volumeKg);
    if (change >= 5) lines.push(`Volume up ${change}% on the period before, across ${totals.sessions} ${sessionWord}.`);
    else if (change <= -5) lines.push(`Volume down ${Math.abs(change)}% on the period before. Fine for a deload, worth a look if it was not one.`);
    else lines.push(`Volume held steady with the period before, across ${totals.sessions} ${sessionWord}.`);
  } else {
    lines.push(`${totals.sessions} ${sessionWord} logged, ${formatTonnage(totals.volumeKg, unit)} moved.`);
  }

  const top = report.records[0];
  if (top) {
    lines.push(
      top.previousKg === null
        ? `First real benchmark on ${top.name}: an estimated ${round(toUnit(top.oneRepMaxKg, unit))} ${unit} max.`
        : `Best progress: ${top.name}, estimated max up ${round(toUnit(top.oneRepMaxKg - top.previousKg, unit))} ${unit}.`,
    );
  }

  if (report.biggestSession) {
    lines.push(`Biggest session: ${report.biggestSession.name}, ${formatTonnage(report.biggestSession.volumeKg, unit)}.`);
  }

  const leader = report.muscles[0];
  const trailer = report.muscles.at(-1);
  if (leader && trailer && report.muscles.length >= 3 && leader.sets >= trailer.sets * 3) {
    lines.push(`${leader.muscle} got ${leader.sets} sets; ${trailer.muscle} only ${trailer.sets}. Worth evening out.`);
  }

  return lines.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Formatting, shared with the renderers
// ---------------------------------------------------------------------------

export function toUnit(kg: number, unit: WeightUnit): number {
  return toDisplayWeight(kg, unit);
}

/** Whole above 100, nearest half below: the same rounding the PDF and the bot print. */
function round(value: number): string {
  return value >= 100 ? Math.round(value).toString() : (Math.round(value * 2) / 2).toString();
}

/** "18.4 t", "8,420 kg", "40.6k lb". Big totals read better short. */
export function formatTonnage(kg: number, unit: WeightUnit): string {
  if (unit === 'kg') {
    return kg >= 10_000 ? `${(kg / 1000).toFixed(1)} t` : `${groupThousands(Math.round(kg))} kg`;
  }
  const lb = toUnit(kg, 'lb');
  return lb >= 10_000 ? `${(lb / 1000).toFixed(1)}k lb` : `${groupThousands(Math.round(lb))} lb`;
}

export function groupThousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Whole percent, positive for growth. Zero when there is nothing to compare with. */
export function percentChange(now: number, before: number): number {
  if (before <= 0) return 0;
  return Math.round(((now - before) / before) * 100);
}

/** "6 – 12 Oct 2026", "28 Sep – 4 Oct 2026". */
export function formatPeriod(from: number, to: number, timeZone?: string): string {
  const last = to - 1;
  const parts = (time: number) => {
    const values = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(new Date(time));
    const get = (type: string) => values.find((part) => part.type === type)?.value ?? '';
    return { day: get('day'), month: get('month'), year: get('year') };
  };
  const a = parts(from);
  const b = parts(last);
  if (a.year !== b.year) return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`;
  if (a.month !== b.month) return `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}`;
  return `${a.day} – ${b.day} ${b.month} ${b.year}`;
}

/** YYYY-MM-DD in the given zone. */
export function dayKey(time: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(time));
}

function dayLabel(time: number, days: number, timeZone?: string): string {
  // A week reads by weekday; two weeks by date, since "Mon" would appear twice.
  return new Intl.DateTimeFormat('en-GB', days <= 7 ? { weekday: 'short', ...(timeZone ? { timeZone } : {}) } : { day: 'numeric', ...(timeZone ? { timeZone } : {}) }).format(new Date(time));
}

function weekLabel(time: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...(timeZone ? { timeZone } : {}) }).format(new Date(time));
}

/**
 * Epoch ms of local midnight on the day `time` falls in, in `timeZone`.
 *
 * Done with `Intl` alone so the server, whose clock is UTC, can count a user's
 * week in their own days. Two passes settle the offset across a DST change.
 */
export function startOfDayIn(time: number, timeZone?: string): number {
  const [year, month, day] = dayKey(time, timeZone).split('-').map(Number) as [number, number, number];
  let guess = Date.UTC(year, month - 1, day);
  for (let pass = 0; pass < 2; pass++) guess = Date.UTC(year, month - 1, day) - offsetAt(guess, timeZone);
  return guess;
}

/** How far ahead of UTC the zone's wall clock is at `time`, in ms. */
function offsetAt(time: number, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(new Date(time));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wall - Math.floor(time / 1000) * 1000;
}

/** The seven days ending at the most recent local midnight: "last week" on a Sunday night or a Monday morning. */
export function lastDaysWindow(now: number, days: number, timeZone?: string): { from: number; to: number } {
  const to = startOfDayIn(now, timeZone);
  let from = to;
  for (let i = 0; i < days; i++) from = startOfDayIn(from - 12 * 60 * 60 * 1000, timeZone);
  return { from, to };
}
