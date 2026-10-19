/**
 * Hands the thread back to the event loop for one turn.
 *
 * On web every query goes through expo-sqlite's synchronous bridge, which
 * busy-waits on the main thread until the worker answers, and awaiting one of
 * Drizzle's builders settles as a microtask. So a loop of awaited writes never
 * gives the browser a turn: no input, no paint, for however long the whole loop
 * takes. A catalog seed or a full-history pull is long enough for that to read
 * as the app having hung.
 *
 * A macrotask between batches lets the browser process clicks and paint a frame
 * in between. On native it costs one timer tick per batch.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
