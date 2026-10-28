/**
 * Streamed text, revealed at an even pace.
 *
 * Tokens do not arrive evenly. A provider sends a burst, goes quiet for a
 * moment, then sends three words at once, and painting each burst as it lands
 * makes an answer lurch onto the screen. This holds what has arrived and hands
 * it out a few characters a frame, faster the further behind it is, so the
 * text reads as being written rather than delivered in parcels. The backlog is
 * never allowed to grow: a fast stream is shown fast, just not in jumps.
 *
 * Capped at roughly thirty renders a second. Each one re-parses the reply for
 * its cards, which is cheap but not free, and past thirty the eye cannot tell.
 */

import { useEffect, useRef, useState } from 'react';

/** Frames to work off whatever is waiting. Smaller is snappier and jumpier. */
const CATCH_UP_FRAMES = 6;
/** The slowest the text may appear, in characters a frame. */
const MIN_STEP = 2;
const FRAME_MS = 32;

/**
 * Returns the text to paint and whether it is still catching up.
 *
 * `enabled` is read once per mount by the caller: a reply that was already
 * finished when it appeared, such as one reopened from a stored thread, is
 * shown whole at once.
 */
export function useSmoothText(text: string, enabled: boolean): [string, boolean] {
  const [shown, setShown] = useState(enabled ? '' : text);
  const length = useRef(enabled ? 0 : text.length);
  const target = useRef(text);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    target.current = text;
    if (!enabled) return;

    // A new, shorter text is a different answer: start it from where it is.
    if (text.length < length.current) length.current = 0;
    if (frame.current !== null) return;

    let last = 0;
    const tick = (now: number) => {
      const goal = target.current;
      const backlog = goal.length - length.current;
      if (backlog <= 0) {
        frame.current = null;
        return;
      }
      if (now - last >= FRAME_MS) {
        last = now;
        length.current = Math.min(goal.length, length.current + Math.max(MIN_STEP, Math.ceil(backlog / CATCH_UP_FRAMES)));
        setShown(goal.slice(0, length.current));
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [text, enabled]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  if (!enabled || !text.startsWith(shown)) return [text, false];
  return [shown, shown.length < text.length];
}
