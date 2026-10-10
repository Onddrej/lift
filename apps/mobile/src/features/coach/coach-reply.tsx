/**
 * One coach reply: prose, cards, and the next steps to tap.
 *
 * The split into segments is `parseCoachReply`, under test in `@lift/shared`.
 * This decides what each segment looks like and one thing more: only the
 * latest reply's choices can be tapped. Choices under an answer from ten turns
 * ago are a menu for a conversation that has moved on, and tapping one would
 * answer a question nobody is asking any more.
 */

import { parseCoachReply, type CoachSegment } from '@lift/shared';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip, Text } from '@/components/ui';
import { spacing } from '@/theme';

import { ExerciseCard } from './cards/exercise-card';
import { MusclesCard } from './cards/muscles-card';
import { PlanCard } from './cards/plan-card';
import { RichText } from './rich-text';

export interface CoachReplyProps {
  text: string;
  /** Whether this reply's choices are live. True for the latest settled reply only. */
  interactive: boolean;
  onChoose: (option: string) => void;
}

export function CoachReply({ text, interactive, onChoose }: CoachReplyProps) {
  const segments = useMemo(() => parseCoachReply(text), [text]);

  // Pinned against Fabric's view flattening: layout-only, and its children
  // change on every streamed token.
  return (
    <View collapsable={false} style={styles.reply}>
      {segments.map((segment, index) => (
        <Segment
          key={keyOf(segment, index)}
          segment={segment}
          interactive={interactive}
          onChoose={onChoose}
        />
      ))}
    </View>
  );
}

function Segment({
  segment,
  interactive,
  onChoose,
}: {
  segment: CoachSegment;
  interactive: boolean;
  onChoose: (option: string) => void;
}) {
  if (segment.kind === 'text') return <RichText text={segment.text} />;

  if (segment.kind === 'pending') {
    return (
      <Text variant="caption" color="textTertiary">
        Preparing a card…
      </Text>
    );
  }

  const { card } = segment;
  switch (card.card) {
    case 'exercise':
      return <ExerciseCard name={card.exercise} />;
    case 'muscles':
      return <MusclesCard />;
    case 'plan':
      return <PlanCard plan={card.plan} />;
    case 'choices':
      return (
        <View style={styles.choices}>
          {card.question && <Text variant="bodyMedium">{card.question}</Text>}
          {interactive && (
            <View style={styles.chips}>
              {card.options.map((option) => (
                <Chip key={option} label={option} onPress={() => onChoose(option)} />
              ))}
            </View>
          )}
        </View>
      );
  }
}

/**
 * Stable across re-parses, so a card already on screen is not remounted, and
 * does not reload its data, every time another token arrives after it.
 */
function keyOf(segment: CoachSegment, index: number): string {
  if (segment.kind !== 'card') return `${segment.kind}-${index}`;
  const { card } = segment;
  switch (card.card) {
    case 'exercise':
      return `exercise-${card.exercise}-${index}`;
    case 'plan':
      return `plan-${card.plan.title}-${index}`;
    default:
      return `${card.card}-${index}`;
  }
}

const styles = StyleSheet.create({
  reply: { gap: spacing.md },
  choices: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
