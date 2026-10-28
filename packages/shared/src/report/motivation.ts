/**
 * The bot's line of the day.
 *
 * Written for this app rather than collected: a famous quote pinned to the
 * wrong person is the most common thing these lists get wrong, and lines about
 * lifting can be specific in a way borrowed ones are not.
 *
 * `lineForDay` picks by the date, so every message sent on one day carries the
 * same line and a user never sees two in a row repeat.
 */

export const MOTIVATION_LINES: readonly string[] = [
  'The bar does not care how you feel. Show up anyway and it will meet you halfway.',
  'One more good session is the whole plan. Today is that session.',
  'Strength is boring on purpose: same lifts, a little more, for a long time.',
  'You do not need motivation. You need your shoes on and the first warm-up set done.',
  'Every heavy single you hit was once a weight you could not move.',
  'Consistency beats intensity you cannot repeat.',
  'Log it. Future you trains off what present you writes down.',
  'A short workout still counts. A skipped one never does.',
  'Progress hides in the third set, the one you almost did not do.',
  'Rest days build the muscle. Training days earn them.',
  'Add a rep, add a plate, or add a week. Something moves.',
  'Leave one rep in the tank and come back stronger on Thursday.',
  'The warm-up is not a formality. It is how you get to lift for twenty more years.',
  'The plan only works on the days you follow it. Today is one of those days.',
  'You are one session away from a better week.',
  'Small plates are how big lifts happen.',
  'Today is a good day to beat last week by a little.',
  'Bad sessions are data. Missed sessions are noise.',
  'Brace, breathe, drive. Then do it again.',
  'Your body keeps the receipts. Make today a good one.',
  'The gym is the one place where effort always gets counted.',
  'You have lifted on worse days than this one.',
  'Get in, do the work, write it down, go home. Repeat.',
  'The person who trains three times a week for a year wins.',
  'Tired is fine. Sloppy is not. Take the extra rest and make the reps clean.',
  'Nobody remembers the weeks they skipped. Everybody feels them.',
  'Sleep, protein, the next set. That is the whole secret.',
  'Chase the logbook, not the mirror.',
  'Heavy is relative. Showing up is not.',
  'Ten good minutes beat zero perfect ones.',
  'Make the first rep look exactly like the last.',
  'Strong is a habit before it is a number.',
  'Plan the work, then trust it when it gets hard.',
  'Your streak is not about the streak. It is about who you are becoming.',
  'Earn the deload.',
  'The weight you fear today is your warm-up next year.',
  'Train the lift you avoid. That is where the progress is hiding.',
  'Momentum is built one boring Tuesday at a time.',
  'Strong days are made on ordinary ones. This is an ordinary one: go.',
  'Hard sets, honest reps, written down.',
];

/** The same line all day, a different one tomorrow. `day` is YYYY-MM-DD. */
export function lineForDay(day: string): string {
  let hash = 0;
  for (const char of day) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return MOTIVATION_LINES[hash % MOTIVATION_LINES.length]!;
}
