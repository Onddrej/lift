/**
 * Training reports: the numbers, the PDF, and the bot's line of the day.
 *
 * A subpath of its own, `@lift/shared/report`, so pdf-lib is only loaded by
 * the screens and services that draw a report, not by everything that imports
 * the package root.
 */

export * from './model.ts';
export * from './motivation.ts';
export * from './pdf.ts';
