/**
 * The way into the training report, from Statistics.
 *
 * Drawn in the report's own ink and lime rather than as one more grey row:
 * it opens a document with the logo on it, and the card says so before the
 * tap rather than after.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { LiftMark } from '@/components/brand/lift-mark';
import { PressableScale, Text } from '@/components/ui';
import { radius, spacing } from '@/theme';

const INK = '#0C0C0F';
const INK_PRESSED = '#1B1B21';
const LIME = '#D2F34B';

export function ReportEntryCard() {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Training report. Your week or month as a designed PDF."
      fill={INK}
      fillPressed={INK_PRESSED}
      style={styles.card}
      onPress={() => router.push('/stats/report')}
    >
      <LiftMark size={34} color={LIME} background={INK} />
      <View style={styles.text}>
        <Text variant="overline" style={{ color: LIME }}>
          New
        </Text>
        <Text variant="subheading" style={{ color: '#F5F5F7' }}>
          Training report
        </Text>
        <Text variant="caption" style={{ color: '#A1A1AC' }}>
          Your week or month as a designed PDF, ready to share.
        </Text>
      </View>
      <Ionicons name="arrow-forward" size={20} color={LIME} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.xl,
    marginTop: spacing.lg,
  },
  text: { flex: 1, gap: 2 },
});
