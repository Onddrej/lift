/**
 * The coach, on Home.
 *
 * It used to be a row on Profile under a name that described an export, and
 * nobody who wanted to ask a question about their training went looking for an
 * export. Here it looks like what it is: a box to ask in, and three questions
 * worth asking, each of which opens the chat already asking it.
 *
 * Only drawn once AI is switched on. Someone who has not opted in does not
 * need a card on their main screen advertising it.
 */

import { Ionicons } from '@expo/vector-icons';
import { COACH_STARTERS } from '@lift/shared';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Card, Chip, Text } from '@/components/ui';
import { useSettings } from '@/store/settings';
import { radius, spacing, stroke, useColors } from '@/theme';

/** Three, so they fit on one row on most phones. */
const STARTERS_SHOWN = 3;

export function CoachEntryCard({ style }: { style?: ViewStyle }) {
  const colors = useColors();
  const enabled = useSettings((state) => state.aiEnabled);
  if (!enabled) return null;

  return (
    <Card style={[styles.card, style]}>
      <View style={styles.title}>
        <Ionicons name="sparkles" size={16} color={colors.accent} />
        <Text variant="bodyMedium">Coach</Text>
      </View>

      <Pressable
        onPress={() => router.push('/coach/chat')}
        accessibilityRole="button"
        accessibilityLabel="Ask your coach"
        style={({ pressed }) => [
          styles.ask,
          {
            borderColor: colors.border,
            backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted,
          },
        ]}
      >
        <Text variant="body" color="textTertiary" style={styles.flex} numberOfLines={1}>
          Ask about your training
        </Text>
        <View style={[styles.send, { backgroundColor: colors.accent }]}>
          <Ionicons name="arrow-up" size={16} color={colors.textOnAccent} />
        </View>
      </Pressable>

      <View style={styles.chips}>
        {COACH_STARTERS.slice(0, STARTERS_SHOWN).map((starter) => (
          <Chip
            key={starter.label}
            label={starter.label}
            icon={starter.icon as ComponentProps<typeof Ionicons>['name']}
            onPress={() => router.push({ pathname: '/coach/chat', params: { ask: starter.question } })}
          />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  title: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ask: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: stroke.outline,
  },
  flex: { flex: 1 },
  send: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
