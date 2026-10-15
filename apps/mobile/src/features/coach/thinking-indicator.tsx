/**
 * What the coach is doing before its first word.
 *
 * Three dots in a travelling wave and a line saying which step it is on:
 * reading the log, thinking, looking something up. A pause that says what it
 * is reads as work; a pause that says nothing reads as a hang, and the first
 * answer of a chat can take several seconds before a token arrives.
 *
 * The wave runs on the UI thread from one shared clock, so the dots keep
 * moving while the JS thread is busy building the log, which is exactly when
 * they are on screen. Under reduced motion the clock does not run and the dots
 * sit still; the line beside them still says what is happening.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { duration, easing, spacing, useColors } from '@/theme';

/** One full pass of the wave. */
const CYCLE_MS = 1200;
/** How far behind its neighbour each dot runs, as a share of the cycle. */
const DOT_LAG = 0.14;
/** Share of the cycle a dot spends lifted. The rest it rests. */
const LIFT_SHARE = 0.42;
const LIFT = 3;
const DOT = 6;

export function ThinkingIndicator({ label }: { label: string }) {
  const colors = useColors();
  const clock = useSharedValue(0);

  useEffect(() => {
    clock.set(
      withRepeat(
        withTiming(1, { duration: CYCLE_MS, easing: Easing.linear, reduceMotion: ReduceMotion.System }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(clock);
  }, [clock]);

  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLabel={label}>
      <View style={styles.dots}>
        {[0, 1, 2].map((index) => (
          <Dot key={index} clock={clock} index={index} color={colors.accent} />
        ))}
      </View>
      {/* Keyed on the label so a change of step crossfades in rather than snapping. */}
      <Animated.View
        key={label}
        collapsable={false}
        entering={FadeIn.duration(duration.base).easing(easing.out).reduceMotion(ReduceMotion.System)}
      >
        <Text variant="body" color="textTertiary">
          {label}
        </Text>
      </Animated.View>
    </View>
  );
}

function Dot({ clock, index, color }: { clock: SharedValue<number>; index: number; color: string }) {
  const style = useAnimatedStyle(() => {
    const phase = (clock.get() - index * DOT_LAG + 1) % 1;
    const lift = phase < LIFT_SHARE ? Math.sin((phase / LIFT_SHARE) * Math.PI) : 0;
    return {
      opacity: 0.35 + 0.65 * lift,
      transform: [{ translateY: -LIFT * lift }],
    };
  });

  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 24 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5, height: DOT + LIFT * 2 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});
