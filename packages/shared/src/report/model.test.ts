import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildTrainingReport, lastDaysWindow, startOfDayIn, type ReportSetRow, type ReportWorkoutRow } from './model.ts';
import { lineForDay, MOTIVATION_LINES } from './motivation.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 15, 12);

function set(exerciseId: string, weightKg: number, reps: number, extra: Partial<ReportSetRow> = {}): ReportSetRow {
  return {
    exerciseId,
    exerciseName: exerciseId === 'bench' ? 'Bench Press (Barbell)' : 'Squat (Barbell)',
    primaryMuscle: exerciseId === 'bench' ? 'chest' : 'quads',
    trackingType: 'weight_reps',
    setType: 'normal',
    weightKg,
    reps,
    durationSeconds: null,
    distanceKm: null,
    isCompleted: true,
    ...extra,
  };
}

function workout(daysAgo: number, sets: ReportSetRow[]): ReportWorkoutRow {
  return { id: `w${daysAgo}`, name: `Day ${daysAgo}`, startedAt: NOW - daysAgo * DAY, durationSeconds: 3600, sets };
}

describe('buildTrainingReport', () => {
  const workouts = [
    workout(10, [set('bench', 80, 5), set('squat', 100, 5)]),
    workout(3, [set('bench', 85, 5), set('bench', 60, 10, { setType: 'warmup' }), set('squat', 100, 5)]),
    workout(1, [set('squat', 100, 5, { isCompleted: false })]),
  ];
  const report = buildTrainingReport({ workouts, from: NOW - 7 * DAY, to: NOW, unit: 'kg', generatedAt: NOW, timeZone: 'UTC' });

  it('counts only completed working sets in the window', () => {
    assert.equal(report.totals.sessions, 2);
    assert.equal(report.totals.sets, 2);
    assert.equal(report.totals.volumeKg, 85 * 5 + 100 * 5);
  });

  it('compares against the window of the same length before it', () => {
    assert.equal(report.previous.sessions, 1);
    assert.equal(report.previous.volumeKg, 80 * 5 + 100 * 5);
  });

  it('reports a record only where the window beat the history', () => {
    assert.deepEqual(
      report.records.map((record) => record.name),
      ['Bench Press (Barbell)'],
    );
  });

  it('lays a week out as seven daily bars', () => {
    assert.equal(report.buckets.length, 7);
    assert.equal(report.buckets.reduce((sum, bucket) => sum + bucket.sessions, 0), 2);
  });

  it('does not call every lift a record in a brand new log', () => {
    const fresh = buildTrainingReport({ workouts: [workouts[1]!], from: NOW - 7 * DAY, to: NOW, unit: 'kg', generatedAt: NOW });
    assert.equal(fresh.records.length, 0);
  });
});

describe('days in a zone', () => {
  it('finds local midnight east of UTC', () => {
    // 05:30 UTC on the 15th is 11:00 in Kolkata, whose midnight is 18:30 UTC on the 14th.
    assert.equal(startOfDayIn(Date.UTC(2026, 9, 15, 5, 30), 'Asia/Kolkata'), Date.UTC(2026, 9, 14, 18, 30));
  });

  it('spans exactly the requested days', () => {
    const { from, to } = lastDaysWindow(NOW, 7, 'Europe/London');
    assert.equal(Math.round((to - from) / DAY), 7);
  });
});

describe('lineForDay', () => {
  it('is stable within a day and drawn from the list', () => {
    assert.equal(lineForDay('2026-10-15'), lineForDay('2026-10-15'));
    assert.ok(MOTIVATION_LINES.includes(lineForDay('2026-10-16')));
  });
});
