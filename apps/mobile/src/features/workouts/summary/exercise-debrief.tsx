/**
 * One lift on the finish screen: did it move, by how much, and what to do next.
 *
 * Three lines at most, each answering one question, in the order a lifter asks
 * them. The badge is the verdict, read at a glance. The first line is the best
 * set and how it compares with last time, which is how lifters keep score. The
 * second is the estimated max, the number that folds weight and reps together
 * and so notices progress the top set misses. Then "Next time", from the same
 * progression engine the logging screen uses, so the target here is the one the
 * user will be offered when they start the session.
 */

import { Ionicons } from '@expo/vector-icons';
import {
  EFFORT_LABELS,
  formatDistance,
  formatDurationShort,
  formatWeight,
  isWorkingSet,
  type DistanceUnit,
  type ExerciseInsight,
  type WeightUnit,
} from '@lift/shared';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge, Text } from '@/components/ui';
import type { WorkoutSet } from '@/db/schema';
import type { LastTimeComparison } from '@/features/workouts/compare';
import { spacing, useColors } from '@/theme';

export interface ExerciseDebriefProps {
  insight: ExerciseInsight;
  sets: readonly WorkoutSet[];
  comparison: LastTimeComparison | null;
  /** "3 x 8 at 82.5 kg", already in this exercise's unit, or null. */
  nextTime: string | null;
  /** The engine's one-line reason for `nextTime`. */
  nextReason: string | null;
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
}

export function ExerciseDebrief({
  insight,
  sets,
  comparison,
  nextTime,
  nextReason,
  weightUnit,
  distanceUnit,
}: ExerciseDebriefProps) {
  const colors = useColors();
  const badge = badgeFor(insight);
  const best = describeBestSet(sets, weightUnit);
  const measure = describeMeasure(insight, weightUnit, distanceUnit);

  const firstLine = [best, comparison ? `${comparison.text} on last time` : null]
    .filter(Boolean)
    .join(', ');
  const secondLine = [
    measure,
    insight.effort ? `felt ${EFFORT_LABELS[insight.effort].toLowerCase()}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <Text variant="bodyMedium" numberOfLines={1} style={styles.name}>
          {insight.name}
        </Text>
        {badge && <Badge label={badge.label} tone={badge.tone} icon={badge.icon} />}
      </View>

      {firstLine.length > 0 && (
        <Text variant="caption" color="textSecondary">
          {firstLine}
        </Text>
      )}
      {secondLine.length > 0 && (
        <Text variant="caption" color="textSecondary">
          {capitalise(secondLine)}
        </Text>
      )}

      {nextTime && (
        <View style={styles.next}>
          <Ionicons name="arrow-forward-circle-outline" size={16} color={colors.accent} />
          <View style={styles.nextBody}>
            <Text variant="label" color="accent">
              {`Next time: ${nextTime}`}
            </Text>
            {nextReason && (
              <Text variant="caption" color="textTertiary">
                {nextReason}
              </Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

type BadgeTone = 'success' | 'neutral' | 'accent';

/**
 * Down is neutral, not red, for the reason the rest of this screen gives: a
 * lighter Thursday is a fact the lifter is entitled to see, not a failure.
 */
function badgeFor(
  insight: ExerciseInsight,
): { label: string; tone: BadgeTone; icon?: ComponentProps<typeof Ionicons>['name'] } | null {
  switch (insight.verdict) {
    case 'up':
      return { label: `Up ${amount(insight)}`, tone: 'success', icon: 'arrow-up' };
    case 'down':
      return { label: `Down ${amount(insight)}`, tone: 'neutral', icon: 'arrow-down' };
    case 'steady':
      return { label: 'Steady', tone: 'neutral' };
    case 'new':
      return { label: 'First time', tone: 'accent' };
    case 'logged':
      return null;
  }
}

function amount(insight: ExerciseInsight): string {
  if (insight.measure === 'reps') {
    const count = Math.abs(insight.change ?? 0);
    return `${count} ${count === 1 ? 'rep' : 'reps'}`;
  }
  return `${Math.abs(Math.round(insight.changePercent ?? 0))}%`;
}

/**
 * "Est. max 99 kg, was 95 kg". Labelled in words, because "e1RM" means nothing
 * to most of the people who will read it and "est. max" means what it says.
 */
function describeMeasure(
  insight: ExerciseInsight,
  weightUnit: WeightUnit,
  distanceUnit: DistanceUnit,
): string | null {
  if (insight.value === null || insight.measure === null) return null;

  const format = (value: number): string => {
    switch (insight.measure) {
      case 'max':
      case 'load':
        return formatWeight(value, weightUnit, { decimals: 1 });
      case 'reps':
        return `${value} ${value === 1 ? 'rep' : 'reps'}`;
      case 'time':
        return formatDurationShort(value);
      case 'distance':
        return formatDistance(value, distanceUnit);
      default:
        return String(value);
    }
  };

  // Reps are already the best set line above; repeating them adds nothing.
  if (insight.measure === 'reps') return null;

  const label = MEASURE_LABEL[insight.measure];
  const now = `${label} ${format(insight.value)}`;
  return insight.previous !== null ? `${now}, was ${format(insight.previous)}` : now;
}

const MEASURE_LABEL: Record<NonNullable<ExerciseInsight['measure']>, string> = {
  max: 'est. max',
  reps: 'best reps',
  time: 'longest',
  distance: 'farthest',
  load: 'top load',
};

/** The heaviest completed working set and, at that weight, the most reps. */
function describeBestSet(sets: readonly WorkoutSet[], unit: WeightUnit): string | null {
  let best: { weightKg: number; reps: number } | null = null;

  for (const set of sets) {
    if (!set.isCompleted || !isWorkingSet(set.setType) || set.reps === null) continue;
    const weightKg = set.weightKg ?? 0;
    if (
      best === null ||
      weightKg > best.weightKg + 0.001 ||
      (Math.abs(weightKg - best.weightKg) <= 0.001 && set.reps > best.reps)
    ) {
      best = { weightKg, reps: set.reps };
    }
  }

  if (!best) return null;
  const reps = `${best.reps} ${best.reps === 1 ? 'rep' : 'reps'}`;
  return best.weightKg > 0 ? `Best set ${formatWeight(best.weightKg, unit)} x ${best.reps}` : `Best set ${reps}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1 },
  next: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs },
  nextBody: { flex: 1, gap: 2 },
});
