/**
 * The two kinds of row in a coach conversation.
 *
 * The user's turns are bubbles on the right; the coach's are full-width prose
 * with no bubble at all, because an answer with cards in it is a page to read
 * rather than a message to glance at, and a bubble around it would only take
 * width away from the cards.
 *
 * Both are memoised and take only props that hold still between tokens. While
 * an answer streams, the screen re-renders a few dozen times a second, and
 * without this every earlier answer in the thread would re-parse its cards on
 * every one of those renders.
 */

import { Ionicons } from '@expo/vector-icons';
import { describeToolCall, type AiToolCall } from '@lift/shared';
import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { IconButton, Reveal, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme';

import { CoachReply } from './coach-reply';
import { useSmoothText } from './use-smooth-text';

export const UserMessage = memo(function UserMessage({
  text,
  animate,
}: {
  text: string;
  /** Rises in on mount. False for turns that were already there, such as a reopened thread. */
  animate: boolean;
}) {
  const colors = useColors();
  // The accent tint rather than a grey: the light theme's muted surface is a
  // shade off the page, and a bubble you have to look for is not a bubble.
  const bubble = (
    <View style={[styles.bubble, { backgroundColor: colors.accentSurface }]}>
      <Text variant="body" selectable>
        {text}
      </Text>
    </View>
  );

  return animate ? <Reveal style={styles.userRow}>{bubble}</Reveal> : <View style={styles.userRow}>{bubble}</View>;
});

export interface AssistantMessageProps {
  text: string;
  toolCalls?: AiToolCall[];
  /** Still streaming. Only the first value counts: see `useSmoothText`. */
  live: boolean;
  /** The latest settled answer: its choices can be tapped and it can be retried. */
  latest: boolean;
  onChoose: (option: string) => void;
  onRetry: () => void;
  onShare: (text: string) => void;
}

export const AssistantMessage = memo(function AssistantMessage({
  text,
  toolCalls,
  live,
  latest,
  onChoose,
  onRetry,
  onShare,
}: AssistantMessageProps) {
  const colors = useColors();
  // Read once: a row that mounted mid-stream keeps revealing smoothly after the
  // stream hands it over, and a row that mounted finished never animates.
  const [smooth] = useState(live);
  const [visible, revealing] = useSmoothText(text, smooth);
  const writing = live || revealing;

  // Pinned against Fabric's view flattening: layout-only, and its children
  // change on every streamed token.
  return (
    <View collapsable={false} style={styles.answer}>
      {visible.length > 0 && (
        <CoachReply text={visible} interactive={latest && !writing} onChoose={onChoose} streaming={writing} />
      )}

      {toolCalls?.map((call) => (
        <View key={call.id} style={styles.lookup}>
          <Ionicons name="checkmark-circle-outline" size={14} color={colors.textTertiary} />
          <Text variant="caption" color="textTertiary">
            {describeToolCall(call)}
          </Text>
        </View>
      ))}

      {latest && !writing && text.length > 0 && (
        <Reveal style={styles.actions}>
          <IconButton
            name="share-outline"
            size={18}
            color={colors.textTertiary}
            accessibilityLabel="Share this answer"
            onPress={() => onShare(text)}
          />
          <IconButton
            name="refresh-outline"
            size={18}
            color={colors.textTertiary}
            accessibilityLabel="Ask again"
            onPress={onRetry}
          />
        </Reveal>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    borderBottomRightRadius: radius.sm,
  },
  answer: { gap: spacing.sm },
  lookup: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.xs, marginLeft: -spacing.sm },
});
