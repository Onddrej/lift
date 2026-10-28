/**
 * One lift, drawn from the log rather than from the model.
 *
 * The coach only names the exercise. Everything on the card (the curve, the
 * best estimated max, the recent sessions) is read from this phone's database
 * when the card is drawn, so a model that misremembers a number cannot put the
 * wrong one on screen, and a card reopened next month shows next month's log.
 */

import { Ionicons } from '@expo/vector-icons';
import { formatWeight, type WeightUnit } from '@lift/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LineChart } from '@/components/charts/line-chart';
import { Card, Text } from '@/components/ui';
import { getExerciseProgress, type ExerciseProgressPoint } from '@/features/analytics/repository';
import { useSettings } from '@/store/settings';
import { spacing, useColors } from '@/theme';

import { resolveExercise, type CoachExerciseRow } from '../exercise-lookup';

/**
 * How many sessions the curve covers.
 *
 * Enough to show a direction, few enough that one stalled month is visible
 * rather than flattened into a year.
 */
const SESSIONS_SHOWN = 12;

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'ready'; exercise: CoachExerciseRow; points: ExerciseProgressPoint[] };

export function ExerciseCard({ name }: { name: string }) {
  const colors = useColors();
  const unit = useSettings((state) => state.weightUnit);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const exercise = await resolveExercise(name);
        if (!exercise) {
          if (!cancelled) setState({ kind: 'missing' });
          return;
        }
        const settings = useSettings.getState();
        const points = await getExerciseProgress(exercise.id, {
          bodyweightKg: settings.bodyweightKg ?? undefined,
          formula: settings.oneRepMaxFormula,
        });
        if (!cancelled) setState({ kind: 'ready', exercise, points: points.slice(-SESSIONS_SHOWN) });
      } catch {
        if (!cancelled) setState({ kind: 'missing' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [name]);

  if (state.kind === 'loading') {
    return (
      <Card>
        <Text variant="caption" color="textTertiary">
          Loading {name}…
        </Text>
      </Card>
    );
  }

  if (state.kind === 'missing') {
    return (
      <Card>
        <Text variant="caption" color="textTertiary">
          {name} is not in your exercise library.
        </Text>
      </Card>
    );
  }

  const { exercise, points } = state;
  const metric = metricFor(points);
  const series = points.map((point) => ({ x: point.performedAt, y: metric.read(point, unit) }));
  const first = series[0]?.y ?? 0;
  const last = series.at(-1)?.y ?? 0;
  const change = first > 0 && series.length > 1 ? ((last - first) / first) * 100 : null;
  const recent = [...points].reverse().slice(0, 3);

  return (
    <Card
      onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: exercise.id } })}
      style={styles.card}
    >
      <View style={styles.header}>
        <View style={styles.title}>
          <Text variant="bodyMedium" numberOfLines={1}>
            {exercise.name}
          </Text>
          <Text variant="caption" color="textSecondary">
            {points.length === 0
              ? 'Not logged yet'
              : `${metric.label} ${metric.format(last, unit)}${
                  change === null ? '' : `, ${describeChange(change)} over ${series.length} sessions`
                }`}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </View>

      {series.length > 1 && (
        <View collapsable={false} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {width > 0 && (
            <LineChart
              data={series}
              width={width}
              height={110}
              color={change !== null && change < 0 ? colors.textSecondary : colors.accent}
              formatValue={(value) => metric.format(value, unit)}
              showDots={series.length <= 8}
            />
          )}
        </View>
      )}

      {recent.length > 0 && (
        <View style={styles.sessions}>
          {recent.map((point) => (
            <View key={point.performedAt} style={styles.session}>
              <Text variant="caption" color="textTertiary" style={styles.date}>
                {new Date(point.performedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </Text>
              <Text variant="caption" color="textSecondary" style={styles.flex} numberOfLines={1}>
                {point.heaviestKg > 0
                  ? `Heaviest ${formatWeight(point.heaviestKg, unit)}, ${point.totalReps} reps total`
                  : `${point.totalReps} reps total`}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

interface Metric {
  label: string;
  read: (point: ExerciseProgressPoint, unit: WeightUnit) => number;
  format: (value: number, unit: WeightUnit) => string;
}

/**
 * Estimated max where the lift has a load, reps where it does not.
 *
 * A push-up logged without a bodyweight has an estimated max of zero every
 * session, and a flat line at zero says the lift is not moving when the reps
 * say it is.
 */
function metricFor(points: ExerciseProgressPoint[]): Metric {
  if (points.some((point) => point.estimatedOneRepMaxKg > 0)) {
    return {
      label: 'Est. max',
      // Charted in the display unit so the axis and the label agree.
      read: (point, unit) => Number(formatWeight(point.estimatedOneRepMaxKg, unit, { withUnit: false })),
      format: (value, unit) => `${Math.round(value * 10) / 10} ${unit}`,
    };
  }
  return {
    label: 'Total reps',
    read: (point) => point.totalReps,
    format: (value) => `${Math.round(value)}`,
  };
}

function describeChange(percent: number): string {
  const rounded = Math.round(Math.abs(percent));
  if (rounded < 1) return 'steady';
  return `${percent > 0 ? 'up' : 'down'} ${rounded}%`;
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, gap: 2 },
  sessions: { gap: spacing.xs },
  session: { flexDirection: 'row', gap: spacing.sm },
  date: { minWidth: 52 },
  flex: { flex: 1 },
});
