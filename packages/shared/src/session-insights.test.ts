import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  analyzeExercise,
  analyzeSession,
  describeChange,
  describeNextTime,
  effortLabel,
  parseDebrief,
  type ExerciseInsightInput,
  type InsightSet,
} from './session-insights.ts';

function set(weightKg: number | null, reps: number | null, over: Partial<InsightSet> = {}): InsightSet {
  return {
    weightKg,
    reps,
    durationSeconds: null,
    distanceKm: null,
    setType: 'normal',
    isCompleted: true,
    ...over,
  };
}

function lift(
  name: string,
  today: InsightSet[],
  lastTime: InsightSet[] | null,
  over: Partial<ExerciseInsightInput> = {},
): ExerciseInsightInput {
  return { id: name, name, trackingType: 'weight_reps', today, lastTime, ...over };
}

describe('analyzeExercise', () => {
  test('reads more reps at a lighter weight as the progress it is', () => {
    // 80 x 10 estimates higher than 82.5 x 6, and the top set alone would call
    // this a lighter day.
    const insight = analyzeExercise(lift('Bench', [set(80, 10)], [set(82.5, 6)]));
    assert.equal(insight.verdict, 'up');
    assert.equal(insight.measure, 'max');
    assert.ok((insight.changePercent ?? 0) > 1);
  });

  test('calls a sub-one-percent wobble steady rather than progress', () => {
    const insight = analyzeExercise(lift('Bench', [set(100, 5)], [set(100, 5)]));
    assert.equal(insight.verdict, 'steady');
    assert.equal(insight.changePercent, 0);
  });

  test('reports a slip as down', () => {
    const insight = analyzeExercise(lift('Squat', [set(100, 3)], [set(100, 6)]));
    assert.equal(insight.verdict, 'down');
  });

  test('marks a first session new, with nothing to compare', () => {
    const insight = analyzeExercise(lift('Row', [set(60, 10)], null));
    assert.equal(insight.verdict, 'new');
    assert.equal(insight.previous, null);
    assert.ok((insight.value ?? 0) > 60);
  });

  test('treats a last session with no completed working sets as no baseline', () => {
    const warmupOnly = [set(40, 10, { setType: 'warmup' })];
    assert.equal(analyzeExercise(lift('Row', [set(60, 10)], warmupOnly)).verdict, 'new');
  });

  test('ignores warm-ups and unfinished sets today', () => {
    const insight = analyzeExercise(
      lift('Bench', [set(40, 10, { setType: 'warmup' }), set(100, 5), set(200, 5, { isCompleted: false })], [set(100, 5)]),
    );
    assert.equal(insight.workingSets, 1);
    assert.equal(insight.verdict, 'steady');
  });

  test('compares bodyweight work on reps, as a whole number', () => {
    const insight = analyzeExercise(
      lift('Push-up', [set(null, 21)], [set(null, 20)], { trackingType: 'bodyweight_reps' }),
    );
    assert.equal(insight.verdict, 'up');
    assert.equal(insight.measure, 'reps');
    assert.equal(insight.change, 1);
    assert.equal(insight.changePercent, null);
  });

  test('will not grade assisted work without a bodyweight', () => {
    const input = lift('Assisted dip', [set(30, 8)], [set(40, 8)], { trackingType: 'assisted_bodyweight' });
    assert.equal(analyzeExercise(input).verdict, 'logged');
    // With one, less help is a heavier effective load and reads as progress.
    assert.equal(analyzeExercise(input, { bodyweightKg: 80 }).verdict, 'up');
  });

  test('reports effort only when most sets were rated', () => {
    const rated = analyzeExercise(lift('Bench', [set(100, 5, { rpe: 9 }), set(100, 5, { rpe: 9 })], null));
    assert.equal(rated.averageRpe, 9);
    assert.equal(rated.effort, 'hard');

    const sparse = analyzeExercise(
      lift('Bench', [set(100, 5, { rpe: 9 }), set(100, 5), set(100, 5)], null),
    );
    assert.equal(sparse.averageRpe, null);
  });
});

describe('effortLabel', () => {
  test('follows reps in reserve', () => {
    assert.equal(effortLabel(6), 'easy');
    assert.equal(effortLabel(7.5), 'solid');
    assert.equal(effortLabel(9), 'hard');
    assert.equal(effortLabel(10), 'all-out');
  });
});

describe('analyzeSession', () => {
  const base = { volumeKg: 5000, previousRoutineVolumeKg: null, recordCount: 0 };

  test('a session where lifts moved and none slipped is strong', () => {
    const insights = analyzeSession({
      ...base,
      exercises: [lift('Bench', [set(80, 10)], [set(80, 8)]), lift('Row', [set(60, 10)], [set(60, 10)])],
    });
    assert.equal(insights.tone, 'great');
    assert.equal(insights.headline, 'Strong session');
    assert.equal(insights.tally, '1 lift up, 1 steady');
    assert.match(insights.detail ?? '', /^Bench led the way, est\. max up \d+%\.$/);
  });

  test('a record makes a session strong even with a slip', () => {
    const insights = analyzeSession({
      ...base,
      recordCount: 1,
      exercises: [lift('Squat', [set(100, 3)], [set(100, 6)])],
    });
    assert.equal(insights.tone, 'great');
    assert.equal(insights.tally, '1 down, 1 record');
  });

  test('more slips than gains reads lighter, and names the slip', () => {
    const insights = analyzeSession({
      ...base,
      exercises: [lift('Squat', [set(100, 3)], [set(100, 6)])],
    });
    assert.equal(insights.tone, 'tough');
    assert.match(insights.detail ?? '', /^Squat slipped est\. max down \d+%\./);
  });

  test('nothing to compare is a baseline, not a grade', () => {
    const insights = analyzeSession({ ...base, exercises: [lift('Row', [set(60, 10)], null)] });
    assert.equal(insights.tone, 'baseline');
    assert.equal(insights.tally, '1 new');
  });

  test('all steady says so', () => {
    const insights = analyzeSession({ ...base, exercises: [lift('Row', [set(60, 10)], [set(60, 10)])] });
    assert.equal(insights.tone, 'steady');
    assert.ok(insights.detail);
  });

  test('compares volume with the last run of the routine', () => {
    const insights = analyzeSession({
      ...base,
      volumeKg: 5500,
      previousRoutineVolumeKg: 5000,
      exercises: [lift('Row', [set(60, 10)], null)],
    });
    assert.equal(Math.round(insights.volumeChangePercent ?? 0), 10);
  });

  test('drops exercises with no completed working sets', () => {
    const insights = analyzeSession({
      ...base,
      exercises: [lift('Row', [set(60, 10, { isCompleted: false })], [set(60, 10)])],
    });
    assert.equal(insights.exercises.length, 0);
    assert.equal(insights.tally, 'Nothing to compare yet');
  });
});

describe('describeChange', () => {
  test('speaks reps as counts and maxes as percents', () => {
    const reps = analyzeExercise(
      lift('Pull-up', [set(null, 8)], [set(null, 10)], { trackingType: 'bodyweight_reps' }),
    );
    assert.equal(describeChange(reps), '2 fewer reps');

    const max = analyzeExercise(lift('Bench', [set(105, 5)], [set(100, 5)]));
    assert.equal(describeChange(max), 'est. max up 5%');
  });
});

describe('describeNextTime', () => {
  test('collapses identical sets the way a programme is written', () => {
    const line = describeNextTime(
      {
        kind: 'add_weight',
        reason: 'Cleared 12 reps',
        sets: [1, 2, 3].map((workingIndex) => ({ workingIndex, weightKg: 82.5, reps: 8 })),
      },
      'kg',
    );
    assert.equal(line, '3 x 8 at 82.5 kg');
  });

  test('lists sets that differ, in the user unit', () => {
    const line = describeNextTime(
      {
        kind: 'add_reps',
        reason: 'Add a rep',
        sets: [
          { workingIndex: 1, weightKg: 100, reps: 6 },
          { workingIndex: 2, weightKg: 100, reps: 5 },
        ],
      },
      'lb',
    );
    assert.match(line ?? '', /^220\.4\d* lb x 6 reps, 220\.4\d* lb x 5 reps$/);
  });

  test('bodyweight work has no load to print', () => {
    const line = describeNextTime(
      { kind: 'add_reps', reason: 'Add a rep', sets: [{ workingIndex: 1, weightKg: null, reps: 11 }] },
      'kg',
    );
    assert.equal(line, '1 x 11');
  });
});

describe('parseDebrief', () => {
  test('reads the four labelled lines', () => {
    const debrief = parseDebrief(
      'Headline: Bench moved, squat held.\nWent well: Bench est. max is up.\n**Watch:** Side delts are short this week.\nNext time: Add a set of lateral raises.',
    );
    assert.deepEqual(debrief, {
      headline: 'Bench moved, squat held.',
      lines: [
        { label: 'Went well', text: 'Bench est. max is up.' },
        { label: 'Watch', text: 'Side delts are short this week.' },
        { label: 'Next time', text: 'Add a set of lateral raises.' },
      ],
    });
  });

  test('returns null for a paragraph, so an old summary still prints', () => {
    assert.equal(parseDebrief('Bench moved 2.5 kg. Squat stalled at 100 kg for the third week.'), null);
  });

  test('returns null when a stray line breaks the shape', () => {
    assert.equal(parseDebrief('Headline: Fine.\nWent well: Bench.\nThanks for training!'), null);
  });

  test('needs more than a headline', () => {
    assert.equal(parseDebrief('Headline: Fine.'), null);
  });

  test('tolerates a half-streamed answer', () => {
    assert.deepEqual(parseDebrief('Headline: Fine.\nWent well: Bench.\nWatch:'), {
      headline: 'Fine.',
      lines: [{ label: 'Went well', text: 'Bench.' }],
    });
    assert.deepEqual(parseDebrief('Headline: Fine.\nWent well: Bench.\nWat', { partial: true }), {
      headline: 'Fine.',
      lines: [{ label: 'Went well', text: 'Bench.' }],
    });
  });
});
