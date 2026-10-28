/**
 * How far the software keyboard reaches into a container, for a composer that
 * has to stay above it.
 *
 * `softwareKeyboardLayoutMode: "resize"` is meant to make this unnecessary on
 * Android, but under the edge-to-edge layout Expo now enforces the window no
 * longer shrinks for the keyboard, and a composer pinned to the bottom of the
 * coach chat sat behind it. iOS never resized.
 *
 * So this does not guess which platform behaviour is in force. It measures the
 * container against the keyboard's top edge and reports only the overlap that
 * is actually there: zero where the window did resize, the keyboard's reach
 * where it did not. The container is re-measured whenever it lays out, so a
 * resize that lands a frame after the keyboard event corrects the figure
 * rather than doubling it.
 *
 * Not `useAnimatedKeyboard`: on Android it takes over the window's insets for
 * as long as it is mounted, which `rest-timer-bar.tsx` explains the cost of.
 */

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { Keyboard, Platform, type View } from 'react-native';
import { ReduceMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { duration, easing } from '@/theme';

export function useKeyboardInset(container: RefObject<View | null>): {
  inset: SharedValue<number>;
  /** Pass to the container's `onLayout`. */
  remeasure: () => void;
} {
  const inset = useSharedValue(0);
  /** Where the keyboard's top edge is, in window coordinates, or null when it is down. */
  const keyboardTop = useRef<number | null>(null);
  const lastDuration = useRef(0);

  const settle = useCallback(
    (target: number, ms: number) => {
      inset.set(
        withTiming(target, {
          // iOS hands over its own animation time so the composer travels with
          // the keyboard. Android reports none, and the token stands in.
          duration: ms > 0 ? ms : duration.base,
          easing: easing.inOut,
          reduceMotion: ReduceMotion.System,
        }),
      );
    },
    [inset],
  );

  const remeasure = useCallback(() => {
    const top = keyboardTop.current;
    if (top === null) {
      settle(0, lastDuration.current);
      return;
    }
    container.current?.measureInWindow((_x, y, _width, height) => {
      settle(Math.max(0, y + height - top), lastDuration.current);
    });
  }, [container, settle]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const shown = Keyboard.addListener(showEvent, (event) => {
      keyboardTop.current = event.endCoordinates.screenY;
      lastDuration.current = event.duration;
      remeasure();
    });
    const hidden = Keyboard.addListener(hideEvent, (event) => {
      keyboardTop.current = null;
      lastDuration.current = event.duration;
      remeasure();
    });

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [remeasure]);

  return { inset, remeasure };
}
