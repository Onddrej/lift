import { Ionicons } from '@expo/vector-icons';
import { formatDuration } from '@lift/shared';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedProps } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { Button, Chip, PressableScale, Text } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { useTicker } from '@/hooks/use-ticker';
import { useSettings } from '@/store/settings';
import { readRest, useTimer } from '@/store/timer';
import { HIT_SLOP, PRESS_SCALE_SMALL, radius, spacing, useColors } from '@/theme';

import {
  ADJUST_SECONDS,
  describeRest,
  spokenDuration,
  useRestControls,
  useRestProgress,
} from './rest-controls';

/*
 * The ring, in viewBox units rather than points.
 *
 * The SVG is laid out at the pixel size computed in the component, so every
 * number below is a proportion of that size: the stroke scales with the ring
 * from a short phone to a tablet without a second set of measurements.
 */
const RING_VIEWBOX = 100;
const RING_STROKE = 6;
const RING_RADIUS = (RING_VIEWBOX - RING_STROKE) / 2;
const RING_CENTER = RING_VIEWBOX / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Past this the ring stops being a dial and starts being a hole in the sheet.
 * Only binds on a dialog: a phone runs out of width first.
 */
const RING_MAX_SIZE = 280;

/**
 * The most of the window's height the ring may take.
 *
 * The sheet stacks a header, the ring, a row of adjusters and a row of actions,
 * and the ring is the only part that can give. Without the cap a short window
 * (a small phone, a browser tab) pushes the actions off the bottom.
 */
const RING_HEIGHT_SHARE = 0.34;

/** The readout's size as a fraction of the ring's, which is what keeps it inside. */
const READOUT_SHARE = 0.27;

/**
 * Below this window width the sheet is docked to the bottom edge at full width,
 * the shape it has on every phone. At and above it the sheet floats in the
 * middle as a dialog, because a 600pt-wide bar of buttons is not a sheet.
 */
const DIALOG_MIN_WINDOW = 600;
const DIALOG_MAX_WIDTH = 440;

const CARD_PADDING = spacing.xxl;

/**
 * The `±` targets: full-width buttons, not the two small discs they used to be.
 * They are pressed with the phone held at arm's length, or on the floor, by
 * someone mid-set.
 */
const ADJUST_HEIGHT = 54;

/** The same range the rest-duration editor allows, for the same reasons. */
const MIN_DRAFT_SECONDS = 5;
const MAX_DRAFT_SECONDS = 3600;

/**
 * The durations offered before a rest is started.
 *
 * Only shown while idle. Once a clock is running the two `±15` buttons are the
 * way to change it, and a row of absolute values would have to mean "restart at
 * this length", which is a different action nobody asked for mid-rest.
 */
const PRESET_SECONDS = [30, 60, 90, 120, 180] as const;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface RestTimerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The resting exercise's configured rest: the chip, and the idle duration. */
  targetSeconds?: number | null;
  onEditRest?: () => void;
}

/**
 * The rest timer, expanded.
 *
 * The docked bar is what the countdown looks like while the user is logging the
 * next set: one row, four controls, gone the moment rest ends. This is what it
 * looks like when the timer itself is the thing being attended to: pausing,
 * changing how long rest should be, or starting one by hand between exercises.
 *
 * It reads the same clock and drives it through the same actions as the bar (see
 * `rest-controls`), so nothing here can disagree with the row underneath it.
 */
export function RestTimerSheet({
  visible,
  onClose,
  targetSeconds,
  onEditRest,
}: RestTimerSheetProps) {
  const colors = useColors();
  const controls = useRestControls();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const restEndsAt = useTimer((state) => state.restEndsAt);
  const restPausedSeconds = useTimer((state) => state.restPausedSeconds);
  const restTotalSeconds = useTimer((state) => state.restTotalSeconds);
  const restKind = useTimer((state) => state.restKind);
  const restExerciseName = useTimer((state) => state.restExerciseName);

  const defaultRestSeconds = useSettings((state) => state.defaultRestSeconds);

  // Gated on `visible` as well as on the clock: a closed modal still renders its
  // children, and there is no reason for a sheet nobody can see to re-render
  // once a second behind the workout.
  const now = useTicker(1000, visible && restEndsAt !== null);
  const rest = readRest({ restEndsAt, restPausedSeconds, restTotalSeconds }, now);
  const frame = rest === null ? null : describeRest(rest, restKind, colors);

  /*
   * The duration offered when there is no rest to show.
   *
   * Re-seeded during render each time the sheet opens, against the values it was
   * last seeded from. The pattern `rest-duration-sheet` uses, and for the same
   * reason: an effect would land a commit later and show the previous number for
   * a frame. A rest that starts while the sheet is open takes over from the
   * draft on its own, because `rest` stops being null.
   */
  const offered = clampDraft(targetSeconds ?? defaultRestSeconds);
  const [draft, setDraft] = useState(offered);
  const [seed, setSeed] = useState({ visible, offered });

  if (seed.visible !== visible || seed.offered !== offered) {
    setSeed({ visible, offered });
    if (visible) setDraft(offered);
  }

  const remaining = useRestProgress({ idleValue: 1, enabled: visible });

  const ringProps = useAnimatedProps(() => ({
    // `strokeDasharray` is one circumference of dash followed by one of gap, so
    // the offset alone decides how much of the ring is drawn: none of it at a
    // full circumference, all of it at zero. Animating the offset keeps the
    // whole sweep on the UI thread: the alternative, re-rendering an arc path
    // from JS, is a new `d` string per frame on the thread this app can least
    // afford to load.
    strokeDashoffset: RING_CIRCUMFERENCE * (1 - remaining.value),
  }));

  const idle = frame === null;
  /** No clock to act on: nothing started, or nothing left to cut short. */
  const leaveOnly = idle || frame.finished;

  // Quiet until it is running. A full accent ring on a timer that has not
  // started reads as a rest already under way, and the only thing this state
  // needs to say is "press Start".
  const tone = frame?.tone ?? colors.textSecondary;
  const readout = frame?.readout ?? formatDuration(draft);
  const readoutLabel = frame?.readoutLabel ?? `${spokenDuration(draft)} rest, not started`;
  const status = frame?.status ?? 'Rest timer';
  const subtitle = restExerciseName ?? (idle ? 'Ready' : null);

  // What the readout is a share of, for the line under it. Nothing once the
  // bell has rung: the figure is then time *past* the span, and "of 1:30" under
  // "+0:12" would read as a fraction of something.
  const span = rest !== null && !rest.finished ? `of ${formatDuration(restTotalSeconds)}` : null;

  const docked = windowWidth < DIALOG_MIN_WINDOW;
  const cardWidth = docked ? windowWidth : Math.min(DIALOG_MAX_WIDTH, windowWidth - spacing.xxl * 2);
  const ringSize = Math.floor(
    Math.min(RING_MAX_SIZE, cardWidth - CARD_PADDING * 2, windowHeight * RING_HEIGHT_SHARE),
  );
  const readoutSize = Math.round(ringSize * READOUT_SHARE);

  const adjust = (delta: number) => {
    if (idle) {
      haptics.selection();
      setDraft((current) => clampDraft(current + delta));
      return;
    }

    controls.adjust(delta);
  };

  const skip = () => {
    controls.stop();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      // Both, or neither: Android honours the navigation bar flag only alongside
      // the status bar one. With them the dimmed backdrop reaches the screen's
      // edges and the card can account for the gesture area itself, below.
      statusBarTranslucent
      navigationBarTranslucent
    >
      {/*
        `accessible={false}` on both Pressables, deliberately.

        Pressable defaults to `accessible`, which collapses everything under it
        into one element. The backdrop would announce the whole sheet as a
        single button reading "Rest 1:30 minus 15 plus 15 Skip Pause", and none
        of the controls inside it could be reached. Tap-outside-to-dismiss has no
        screen reader equivalent here on purpose: the close button is one swipe
        away, and Android's back gesture already routes to `onRequestClose`.
      */}
      <Pressable
        accessible={false}
        style={[
          styles.backdrop,
          docked ? styles.backdropDocked : styles.backdropDialog,
          { backgroundColor: colors.overlay },
        ]}
        onPress={onClose}
      >
        {/* Swallows taps inside the card so they don't dismiss the sheet. */}
        <Pressable
          accessible={false}
          // Hides the workout behind the sheet from VoiceOver, so a swipe past
          // the last button lands on the heading again instead of wandering into
          // the set list underneath.
          accessibilityViewIsModal
          style={[
            styles.card,
            docked ? styles.cardDocked : styles.cardDialog,
            {
              backgroundColor: colors.surfaceElevated,
              // Docked to the bottom edge, the buttons would otherwise sit under
              // the gesture pill. Floating, there is no pill to clear.
              paddingBottom: spacing.xl + (docked ? insets.bottom : 0),
            },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          {/* Decoration, not a control: this sheet is not draggable, and the
              grabber is here because a card against the bottom edge without one
              reads as stuck rather than dismissible. It goes when the card stops
              touching that edge. */}
          {docked && (
            <View
              style={[styles.grabber, { backgroundColor: colors.borderStrong }]}
              pointerEvents="none"
            />
          )}

          <View style={styles.heading}>
            <View style={styles.status}>
              <Text variant="overline" style={{ color: tone }} numberOfLines={1}>
                {status}
              </Text>
              {subtitle ? (
                <Text variant="bodyMedium" color="textSecondary" numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>

            {onEditRest !== undefined && targetSeconds != null && (
              <Chip
                label={formatDuration(targetSeconds)}
                icon="pencil"
                onPress={onEditRest}
                // A chip is 36 tall, and it is the only pressable thing in this
                // row: nothing for its slop to contest.
                hitSlop={HIT_SLOP}
                accessibilityLabel={`Rest duration, ${spokenDuration(targetSeconds)}. Edit`}
              />
            )}
          </View>

          <View style={{ width: ringSize, height: ringSize, alignSelf: 'center' }}>
            <Svg width="100%" height="100%" viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}>
              <Circle
                cx={RING_CENTER}
                cy={RING_CENTER}
                r={RING_RADIUS}
                fill="none"
                stroke={colors.surfaceMuted}
                strokeWidth={RING_STROKE}
              />
              <AnimatedCircle
                cx={RING_CENTER}
                cy={RING_CENTER}
                r={RING_RADIUS}
                fill="none"
                // Idle holds the ring full (`idleValue` above), so it is drawn
                // in a hairline-quiet stroke: a bright full circle would say
                // "running".
                stroke={idle ? colors.borderStrong : tone}
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                /*
                 * An SVG circle starts at three o'clock, and a countdown that
                 * begins anywhere but the top is a dial nobody can read at a
                 * glance. Stated in SVG's own transform syntax with the centre
                 * named explicitly: a `transform` in the React Native `style`
                 * of the `Svg` element looks equivalent and is not: the
                 * library lifts it out of the style and re-applies it in SVG
                 * space, where the default origin is the corner of the viewBox
                 * rather than the middle of the shape.
                 */
                transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
                animatedProps={ringProps}
              />
            </Svg>

            <View
              style={[styles.ringCenter, { paddingHorizontal: ringSize * 0.12 }]}
              pointerEvents="none"
            >
              <Text
                variant="numericLarge"
                numberOfLines={1}
                // "+1:05" is wider than "1:30", and the ring is the shape that
                // carries the state, so the figure gives way rather than the
                // ring.
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                accessibilityLabel={readoutLabel}
                style={[
                  styles.readout,
                  { color: tone, fontSize: readoutSize, lineHeight: Math.round(readoutSize * 1.1) },
                ]}
              >
                {readout}
              </Text>
              {span !== null && (
                <Text variant="label" color="textTertiary" style={styles.span}>
                  {span}
                </Text>
              )}
            </View>
          </View>

          {idle && (
            <View style={styles.presets} accessibilityRole="radiogroup">
              {PRESET_SECONDS.map((seconds) => (
                <Chip
                  key={seconds}
                  label={formatDuration(seconds)}
                  selected={draft === seconds}
                  onPress={() => {
                    haptics.selection();
                    setDraft(seconds);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: draft === seconds }}
                  accessibilityLabel={`${spokenDuration(seconds)} rest`}
                />
              ))}
            </View>
          )}

          <View style={styles.adjustRow}>
            <AdjustButton
              icon="remove"
              seconds={ADJUST_SECONDS}
              label={
                idle
                  ? `Subtract ${ADJUST_SECONDS} seconds from the rest duration`
                  : `Subtract ${ADJUST_SECONDS} seconds`
              }
              onPress={() => adjust(-ADJUST_SECONDS)}
            />
            <AdjustButton
              icon="add"
              seconds={ADJUST_SECONDS}
              label={
                idle
                  ? `Add ${ADJUST_SECONDS} seconds to the rest duration`
                  : `Add ${ADJUST_SECONDS} seconds`
              }
              onPress={() => adjust(ADJUST_SECONDS)}
            />
          </View>

          {/*
            Two buttons, in the same two places whatever the timer is doing. The
            pair changes what it says: Close/Start before a rest, Skip/Pause
            during one, Close/Done after the bell, but a control that appears
            and disappears under a thumb is the mis-tap this whole rebuild was
            about. The main action is the wider one, on the right, where the
            thumb already is.

            There is nothing left to skip once the bell has rung, so the left
            button stops offering it and goes back to being a way out that
            leaves the finished timer where it is. Two buttons that both mean
            "dismiss" would be one of them lying about doing something else.
          */}
          <View style={styles.actions}>
            <Button
              title={leaveOnly ? 'Close' : 'Skip'}
              variant="outline"
              size="lg"
              icon={leaveOnly ? undefined : 'play-skip-forward'}
              accessibilityLabel={leaveOnly ? 'Close the rest timer' : 'Skip rest'}
              onPress={leaveOnly ? onClose : skip}
              style={styles.secondaryAction}
            />

            {idle ? (
              <Button
                title="Start"
                size="lg"
                icon="play"
                accessibilityLabel={`Start a ${spokenDuration(draft)} rest`}
                onPress={() => controls.start(draft)}
                style={styles.primaryAction}
              />
            ) : frame.finished ? (
              <Button
                title="Done"
                size="lg"
                icon="checkmark"
                accessibilityLabel="Dismiss the finished rest timer"
                onPress={skip}
                style={styles.primaryAction}
              />
            ) : (
              <Button
                title={frame.paused ? 'Resume' : 'Pause'}
                size="lg"
                icon={frame.paused ? 'play' : 'pause'}
                accessibilityLabel={frame.paused ? 'Resume rest' : 'Pause rest'}
                onPress={controls.togglePause}
                style={styles.primaryAction}
              />
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function AdjustButton({
  icon,
  seconds,
  label,
  onPress,
}: {
  icon: 'add' | 'remove';
  seconds: number;
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      fill={colors.surfaceMuted}
      fillPressed={colors.surfacePressed}
      scaleTo={PRESS_SCALE_SMALL}
      style={[styles.adjust, { backgroundColor: colors.surfaceMuted }]}
    >
      <Ionicons name={icon} size={18} color={colors.text} />
      <Text variant="bodyMedium">{seconds}s</Text>
    </PressableScale>
  );
}

function clampDraft(seconds: number): number {
  return Math.min(MAX_DRAFT_SECONDS, Math.max(MIN_DRAFT_SECONDS, Math.round(seconds)));
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  backdropDocked: { justifyContent: 'flex-end' },
  backdropDialog: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  card: {
    paddingHorizontal: CARD_PADDING,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },
  cardDocked: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  cardDialog: {
    width: '100%',
    maxWidth: DIALOG_MAX_WIDTH,
    borderRadius: radius.xl,
    paddingTop: spacing.xl,
  },
  grabber: {
    width: 36,
    height: spacing.xs,
    borderRadius: radius.pill,
    alignSelf: 'center',
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  status: { flex: 1, gap: 2 },
  // Inset from the ring's own bounds, because that is the box the readout is
  // shrunk to fit: at full width the figure would be sized to touch the stroke
  // on both sides, which is the one place a countdown must not land.
  ringCenter: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readout: { letterSpacing: -1 },
  span: { marginTop: spacing.xs },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    // Five chips are ~320pt wide with the smallest gap, and a 360pt phone leaves
    // ~312: the gap is the one thing that can give before they wrap.
    gap: spacing.xs,
  },
  adjustRow: { flexDirection: 'row', gap: spacing.md },
  adjust: {
    flex: 1,
    height: ADJUST_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.lg,
  },
  actions: { flexDirection: 'row', gap: spacing.md },
  secondaryAction: { flex: 1 },
  primaryAction: { flex: 1.6 },
});
