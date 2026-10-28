/**
 * The top of the finish screen: what kind of session it was, then the numbers.
 *
 * The verdict leads because it is the one thing the four totals could never
 * say on their own. 5,200 kg is a fact; "Strong session, 2 lifts up" is what
 * the fact means, and it is what a lifter checks on the way out of the gym.
 * Every word of it comes from `analyzeSession`, so it is here with the AI coach
 * switched off.
 */

import { Ionicons } from '@expo/vector-icons';
import {
  EFFORT_LABELS,
  formatDurationShort,
  formatVolume,
  type SessionInsights,
  type SessionTone,
  type WeightUnit,
} from '@lift/shared';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Divider, Text, splitMeasure } from '@/components/ui';
import { spacing, useColors } from '@/theme';

type Ink = 'success' | 'accent' | 'warning' | 'record';

/**
 * A lighter session is the warning role, not danger. Red means "this destroys
 * something" everywhere else in the app, and an off day destroys nothing.
 */
const TONE_LOOK: Record<SessionTone, { icon: ComponentProps<typeof Ionicons>['name']; ink: Ink }> = {
  great: { icon: 'trending-up', ink: 'success' },
  good: { icon: 'arrow-up-circle-outline', ink: 'success' },
  steady: { icon: 'swap-horizontal', ink: 'accent' },
  tough: { icon: 'trending-down', ink: 'warning' },
  baseline: { icon: 'flag-outline', ink: 'accent' },
};

export interface VerdictCardProps {
  insights: SessionInsights;
  volumeKg: number;
  durationSeconds: number;
  totalSets: number;
  totalReps: number;
  weightUnit: WeightUnit;
}

export function VerdictCard({
  insights,
  volumeKg,
  durationSeconds,
  totalSets,
  totalReps,
  weightUnit,
}: VerdictCardProps) {
  const colors = useColors();
  const look = TONE_LOOK[insights.tone];

  const volumeNote = describeVolumeChange(insights.volumeChangePercent);

  return (
    <Card style={styles.card}>
      <View style={styles.verdict}>
        <View style={styles.headlineRow}>
          <Ionicons name={look.icon} size={22} color={colors[look.ink]} />
          <Text variant="subheading" color={look.ink} style={styles.headline}>
            {insights.headline}
          </Text>
        </View>
        <Text variant="label" color="textSecondary">
          {insights.tally}
        </Text>
        {insights.detail && <Text variant="body">{insights.detail}</Text>}
      </View>

      <Divider />

      {/* Two columns rather than four across. A four-up row leaves each figure
          a quarter of the width, which `adjustsFontSizeToFit` then resolves per
          tile, and four numbers at four different sizes is not a table. */}
      <View style={styles.stats}>
        <Stat
          label="Volume"
          value={formatVolume(volumeKg, weightUnit)}
          note={volumeNote?.text}
          noteInk={volumeNote?.ink}
        />
        <Stat label="Duration" value={formatDurationShort(durationSeconds)} />
        <Stat label="Sets" value={String(totalSets)} />
        {/* Effort is the more useful fourth figure when the sets were rated:
            reps are already implied by sets, and "how hard was it" is not. */}
        {insights.effort && insights.averageRpe !== null ? (
          <Stat
            label="Effort"
            value={EFFORT_LABELS[insights.effort]}
            note={`Average RPE ${insights.averageRpe}`}
          />
        ) : (
          <Stat label="Reps" value={String(totalReps)} />
        )}
      </View>
    </Card>
  );
}

/**
 * Volume against the last run of the same routine, in words.
 *
 * Within two percent is called the same: a dropped set of curls moves the total
 * that much, and a caption that flickers between up and down on noise teaches
 * the user to stop reading it.
 */
function describeVolumeChange(percent: number | null): { text: string; ink: 'success' | 'textTertiary' } | null {
  if (percent === null) return null;
  const rounded = Math.round(percent);
  if (Math.abs(percent) < 2) return { text: 'Same as last time', ink: 'textTertiary' };
  return rounded > 0
    ? { text: `${rounded}% more than last time`, ink: 'success' }
    : { text: `${Math.abs(rounded)}% less than last time`, ink: 'textTertiary' };
}

/** Label above figure, on a hairline-ruled band: the same grid as `StatBand`. */
function Stat({
  label,
  value,
  note,
  noteInk = 'textTertiary',
}: {
  label: string;
  value: string;
  note?: string;
  noteInk?: 'success' | 'textTertiary';
}) {
  const [figure, unit] = splitMeasure(value);

  return (
    <View style={styles.stat}>
      <Text variant="overline" color="textTertiary">
        {label}
      </Text>
      <Text variant="numericLarge" numberOfLines={1} adjustsFontSizeToFit>
        {figure}
        {unit ? (
          <Text variant="label" color="textTertiary">
            {` ${unit}`}
          </Text>
        ) : null}
      </Text>
      {note ? (
        <Text variant="caption" color={noteInk} numberOfLines={1}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  verdict: { gap: spacing.xs },
  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headline: { flex: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  stat: { width: '50%', paddingRight: spacing.md, gap: spacing.xs },
});
