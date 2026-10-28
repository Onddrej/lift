/**
 * Weekly sets per muscle against the range each one grows in.
 *
 * The same four weeks and the same landmarks the volume advisor reads, drawn as
 * one bar per muscle with its productive band shaded behind it. The point is
 * to make "under", "in range" and "over" visible without reading a number;
 * the number is beside the bar for anyone who wants it.
 *
 * Muscles outside their band come first, worst first, because those are what a
 * coach is pointing at when it shows this card.
 */

import {
  findVolumeGaps,
  landmarksFor,
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUPS,
  type MuscleGroup,
  type TrainingLevel,
  type VolumeLandmarks,
} from '@lift/shared';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { ADVICE_WINDOW_DAYS } from '@/features/ai/volume-advice';
import { getMuscleBoard } from '@/features/analytics/muscle-stats';
import { addDays, startOfDay } from '@/features/analytics/windows';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

/** Rows shown before "Show all". Enough for every problem in a typical log. */
const COLLAPSED_ROWS = 6;

interface Row {
  muscle: MuscleGroup;
  sets: number;
  landmarks: VolumeLandmarks;
}

export function MusclesCard() {
  const colors = useColors();
  const level = useSettings((state) => state.trainingLevel);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const to = addDays(startOfDay(new Date()), 1);
      const board = await getMuscleBoard(addDays(to, -ADVICE_WINDOW_DAYS), to);
      if (!cancelled) setRows(orderRows(board.setsPerWeek, level));
    })().catch(() => {
      if (!cancelled) setRows([]);
    });

    return () => {
      cancelled = true;
    };
  }, [level]);

  if (rows === null) {
    return (
      <Card>
        <Text variant="caption" color="textTertiary">
          Counting your sets…
        </Text>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <Text variant="caption" color="textTertiary">
          No working sets in the last four weeks.
        </Text>
      </Card>
    );
  }

  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);

  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        <Text variant="bodyMedium">Weekly sets per muscle</Text>
        <Text variant="caption" color="textTertiary">
          Last 4 weeks. Shaded: the range that grows muscle.
        </Text>
      </View>

      {shown.map((row) => {
        const scale = Math.max(row.landmarks.mrv * 1.15, row.sets, 1);
        const tone =
          row.sets < row.landmarks.mev ? colors.warning : row.sets > row.landmarks.mrv ? colors.danger : colors.success;

        return (
          <View key={row.muscle} style={styles.row}>
            <View style={styles.rowLabels}>
              <Text variant="caption">{MUSCLE_GROUP_LABELS[row.muscle]}</Text>
              <Text variant="caption" color="textSecondary">
                {`${oneDecimal(row.sets)} of ${row.landmarks.mev}-${row.landmarks.mrv}`}
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
              <View
                style={[
                  styles.band,
                  {
                    left: `${(row.landmarks.mev / scale) * 100}%`,
                    width: `${((row.landmarks.mrv - row.landmarks.mev) / scale) * 100}%`,
                    backgroundColor: colors.successSurface,
                  },
                ]}
              />
              <View
                style={[styles.fill, { width: `${Math.min(100, (row.sets / scale) * 100)}%`, backgroundColor: tone }]}
              />
            </View>
          </View>
        );
      })}

      {rows.length > COLLAPSED_ROWS && (
        <Pressable onPress={() => setExpanded((value) => !value)} hitSlop={8}>
          <Text variant="label" color="accent">
            {expanded ? 'Show fewer' : `Show all ${rows.length}`}
          </Text>
        </Pressable>
      )}
    </Card>
  );
}

/**
 * Out-of-band muscles in the advisor's order, then everything else trained,
 * busiest first. Untrained muscles with no minimum are left out: there is
 * nothing to say about abductors nobody trains directly.
 */
function orderRows(setsPerWeek: Partial<Record<MuscleGroup, number>>, level: TrainingLevel): Row[] {
  const gaps = findVolumeGaps(setsPerWeek, { level });
  const first = gaps.map((gap) => gap.muscle);
  const rest = MUSCLE_GROUPS.filter((muscle) => {
    if (first.includes(muscle)) return false;
    const landmarks = landmarksFor(muscle, level);
    return landmarks.mrv > 0 && ((setsPerWeek[muscle] ?? 0) > 0 || landmarks.mev > 0);
  }).sort((a, b) => (setsPerWeek[b] ?? 0) - (setsPerWeek[a] ?? 0));

  return [...first, ...rest].map((muscle) => ({
    muscle,
    sets: setsPerWeek[muscle] ?? 0,
    landmarks: landmarksFor(muscle, level),
  }));
}

function oneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  heading: { gap: 2 },
  row: { gap: spacing.xs },
  rowLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  band: { position: 'absolute', top: 0, bottom: 0 },
  fill: { height: '100%', borderRadius: radius.pill },
});
