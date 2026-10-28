/**
 * The training report as a branded PDF.
 *
 * Drawn with pdf-lib rather than printed from HTML, because it has to come out
 * of two places that have no browser in common: the phone, where printing would
 * need a native module and a new build, and the API's Alpine image, where it
 * would need a copy of Chromium. pdf-lib is plain JavaScript on both, so the
 * report a user exports and the one the bot sends are the same drawing.
 *
 * The look is the app's: ink background, lime for the one thing on each block
 * that matters, JetBrains Sans throughout. Fonts are passed in as bytes rather
 * than read here, since each caller keeps them somewhere different.
 *
 * Coordinates are written top-down, as on screen. `top()` turns them into
 * pdf-lib's bottom-up space at the last moment, and `drawSvgPath` already
 * thinks in SVG's top-down space, which is why the rounded shapes go through it.
 */

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';

import {
  formatPeriod,
  formatTonnage,
  groupThousands,
  percentChange,
  toUnit,
  type TrainingReport,
} from './model.ts';

export interface ReportFonts {
  regular: Uint8Array;
  semibold: Uint8Array;
  bold: Uint8Array;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const W = 595.28;
const H = 841.89;
const M = 40;
/** Where the notes column starts, beside the hero figure. */
const NOTES_X = 352;
const HERO_WIDTH = NOTES_X - M - 32;

function hex(value: string): RGB {
  const n = Number.parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const C = {
  ink: hex('#0C0C0F'),
  card: hex('#15151A'),
  line: hex('#26262D'),
  text: hex('#F5F5F7'),
  muted: hex('#A1A1AC'),
  dim: hex('#5E5E69'),
  lime: hex('#D2F34B'),
  limeInk: hex('#12180A'),
};

interface Fonts {
  regular: PDFFont;
  semibold: PDFFont;
  bold: PDFFont;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function renderReportPdf(report: TrainingReport, fontBytes: ReportFonts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Lift ${reportTitle(report.days).toLowerCase()}, ${formatPeriod(report.from, report.to, report.timeZone)}`);
  doc.setAuthor('Lift');
  doc.setCreator('Lift');
  doc.setProducer('Lift');

  const fonts: Fonts = {
    regular: await doc.embedFont(fontBytes.regular, { subset: true }),
    semibold: await doc.embedFont(fontBytes.semibold, { subset: true }),
    bold: await doc.embedFont(fontBytes.bold, { subset: true }),
  };

  const page = doc.addPage([W, H]);
  const draw = new Painter(page, fonts);

  draw.rect(0, 0, W, H, C.ink);
  // The mark, enormous and barely there, running off the right edge: the one
  // flourish on a page that is otherwise all figures.
  draw.mark(W - 150, 96, 250, C.lime, 0.03);

  let y = header(draw, report);
  const heroTop = y + 26;
  y = Math.max(hero(draw, report, heroTop), notes(draw, report, heroTop));
  y = tiles(draw, report, y + 18);
  y = chart(draw, report, y + 12);
  y = columns(draw, report, y + 12);
  records(draw, report, y + 12);
  footer(draw, report);

  return doc.save();
}

export function reportTitle(days: number): string {
  if (days >= 6 && days <= 8) return 'Weekly report';
  if (days >= 28 && days <= 31) return 'Monthly report';
  if (days >= 88 && days <= 92) return 'Quarterly report';
  return `${days}-day report`;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function header(draw: Painter, report: TrainingReport): number {
  const y = M;
  draw.mark(M, y, 30, C.lime);
  draw.text('LIFT', M + 32, y + 9, draw.fonts.bold, 17, C.text, { tracking: 2.4 });

  const title = reportTitle(report.days).toUpperCase();
  draw.text(title, W - M, y + 3, draw.fonts.semibold, 7.5, C.lime, { align: 'right', tracking: 1.6 });
  draw.text(formatPeriod(report.from, report.to, report.timeZone), W - M, y + 16, draw.fonts.semibold, 11, C.text, { align: 'right' });
  return y + 30;
}

function hero(draw: Painter, report: TrainingReport, y: number): number {
  const { totals, unit } = report;
  draw.text('TOTAL MOVED', M, y, draw.fonts.semibold, 7.5, C.muted, { tracking: 1.6 });

  const [figure, suffix] = splitTonnage(formatTonnage(totals.volumeKg, unit));
  const size = 68;
  draw.text(figure, M - 3, y + 14, draw.fonts.bold, size, C.text, { tracking: -2 });
  const figureWidth = draw.width(figure, draw.fonts.bold, size, -2);
  draw.text(suffix, M + figureWidth + 6, y + 14 + size * 0.52, draw.fonts.bold, 26, C.lime);

  const who = report.athlete ? `${report.athlete}, ` : '';
  const sessions = totals.sessions === 1 ? '1 session' : `${totals.sessions} sessions`;
  const days = totals.trainingDays === 1 ? '1 day' : `${totals.trainingDays} days`;
  const line = totals.sessions === 0 ? `${who}a quiet stretch. The next one starts with one session.` : `${who}${sessions} over ${days} of ${report.days}.`;
  for (const [index, piece] of draw.wrap(line, draw.fonts.regular, 12, HERO_WIDTH).entries()) {
    draw.text(piece, M, y + 14 + size + 6 + index * 16, draw.fonts.regular, 12, C.muted);
  }

  return y + 14 + size + 40;
}

function tiles(draw: Painter, report: TrainingReport, y: number): number {
  const { totals, previous } = report;
  const gap = 10;
  const width = (W - M * 2 - gap * 3) / 4;
  const height = 74;

  const items: { label: string; value: string; now: number; before: number }[] = [
    { label: 'SESSIONS', value: `${totals.sessions}`, now: totals.sessions, before: previous.sessions },
    { label: 'WORKING SETS', value: groupThousands(totals.sets), now: totals.sets, before: previous.sets },
    { label: 'REPS', value: groupThousands(totals.reps), now: totals.reps, before: previous.reps },
    { label: 'TIME', value: formatMinutes(totals.minutes), now: totals.minutes, before: previous.minutes },
  ];

  items.forEach((item, index) => {
    const x = M + index * (width + gap);
    draw.round(x, y, width, height, 12, C.card);
    draw.text(item.label, x + 14, y + 14, draw.fonts.semibold, 7, C.muted, { tracking: 1.2 });
    draw.text(item.value, x + 14, y + 29, draw.fonts.bold, 22, C.text);
    delta(draw, x + 14, y + 56, item.now, item.before);
  });

  return y + height;
}

/** "▲ 12% vs before" in lime, "▼ 8%" in grey, nothing when there is no earlier period. */
function delta(draw: Painter, x: number, y: number, now: number, before: number) {
  if (before <= 0) return;
  const change = percentChange(now, before);
  if (change === 0) {
    draw.text('same as before', x, y - 1, draw.fonts.regular, 7.5, C.dim);
    return;
  }
  const up = change > 0;
  const color = up ? C.lime : C.muted;
  draw.path(up ? `M 0 6 L 3.5 0 L 7 6 Z` : `M 0 0 L 7 0 L 3.5 6 Z`, x, y, color);
  const label = `${Math.abs(change)}%`;
  draw.text(label, x + 10, y - 1, draw.fonts.semibold, 8, color);
  draw.text('vs before', x + 14 + draw.width(label, draw.fonts.semibold, 8), y - 1, draw.fonts.regular, 7.5, C.dim);
}

function chart(draw: Painter, report: TrainingReport, y: number): number {
  const height = 146;
  const width = W - M * 2;
  draw.round(M, y, width, height, 14, C.card);

  draw.text('VOLUME', M + 18, y + 18, draw.fonts.semibold, 7.5, C.muted, { tracking: 1.6 });
  const daily = report.days <= 14;
  draw.text(daily ? 'per day' : 'per week', M + 18, y + 30, draw.fonts.regular, 10, C.dim);

  const buckets = report.buckets;
  const max = Math.max(1, ...buckets.map((bucket) => bucket.volumeKg));
  const plotTop = y + 46;
  const plotBottom = y + height - 26;
  const plotHeight = plotBottom - plotTop;
  const inner = width - 36;
  const slot = inner / buckets.length;
  const barWidth = Math.min(38, slot * 0.62);

  // Baseline and a faint mid rule, so the bars stand on something.
  draw.rect(M + 18, plotBottom, inner, 0.8, C.line);
  draw.rect(M + 18, plotTop + plotHeight / 2, inner, 0.4, C.line);

  const peak = buckets.reduce((best, bucket, index) => (bucket.volumeKg > (buckets[best]?.volumeKg ?? 0) ? index : best), 0);

  buckets.forEach((bucket, index) => {
    const cx = M + 18 + slot * index + slot / 2;
    const x = cx - barWidth / 2;
    if (bucket.volumeKg > 0) {
      const barHeight = Math.max(6, (bucket.volumeKg / max) * plotHeight);
      draw.roundTop(x, plotBottom - barHeight, barWidth, barHeight, Math.min(6, barWidth / 2), index === peak ? C.lime : hexMix());
      if (index === peak) {
        draw.text(formatTonnage(bucket.volumeKg, report.unit), cx, plotBottom - barHeight - 13, draw.fonts.semibold, 8, C.text, { align: 'center' });
      }
    } else {
      draw.round(cx - 2, plotBottom - 4, 4, 4, 2, C.line);
    }
    draw.text(bucket.label, cx, plotBottom + 9, draw.fonts.regular, 7.5, bucket.volumeKg > 0 ? C.muted : C.dim, { align: 'center' });
  });

  return y + height;
}

/** Bars other than the peak: lime, held back. */
function hexMix(): RGB {
  return rgb(0.824 * 0.55 + 0.082 * 0.45, 0.953 * 0.55 + 0.082 * 0.45, 0.294 * 0.55 + 0.102 * 0.45);
}

function columns(draw: Painter, report: TrainingReport, y: number): number {
  const gap = 12;
  const width = (W - M * 2 - gap) / 2;
  const height = 172;
  const left = M;
  const right = M + width + gap;

  // Top lifts
  draw.round(left, y, width, height, 14, C.card);
  draw.text('TOP LIFTS', left + 18, y + 18, draw.fonts.semibold, 7.5, C.muted, { tracking: 1.6 });
  draw.text('est. max', left + width - 18, y + 18, draw.fonts.regular, 7.5, C.dim, { align: 'right' });

  if (report.lifts.length === 0) {
    draw.text('Nothing lifted in this window.', left + 18, y + 44, draw.fonts.regular, 10, C.dim);
  }
  report.lifts.forEach((lift, index) => {
    const row = y + 38 + index * 26.5;
    draw.text(String(index + 1).padStart(2, '0'), left + 18, row + 1, draw.fonts.bold, 9, C.lime);
    const nameWidth = width - 18 - 40 - 70;
    draw.text(draw.fit(lift.name, draw.fonts.semibold, 10, nameWidth), left + 40, row, draw.fonts.semibold, 10, C.text);
    const best = lift.bestSet ? `${weight(lift.bestSet.weightKg, report.unit)} × ${lift.bestSet.reps}` : '';
    const detail = [`${lift.sets} sets`, best].filter(Boolean).join('  ·  ');
    draw.text(detail, left + 40, row + 12.5, draw.fonts.regular, 7.5, C.muted);
    if (lift.bestOneRepMaxKg > 0) {
      draw.text(`${weight(lift.bestOneRepMaxKg, report.unit)}`, left + width - 18, row + 3, draw.fonts.bold, 11, C.text, { align: 'right' });
    }
  });

  // Muscles
  draw.round(right, y, width, height, 14, C.card);
  draw.text('WHERE THE SETS WENT', right + 18, y + 18, draw.fonts.semibold, 7.5, C.muted, { tracking: 1.6 });
  const most = Math.max(1, ...report.muscles.map((muscle) => muscle.sets));
  if (report.muscles.length === 0) {
    draw.text('No working sets yet.', right + 18, y + 44, draw.fonts.regular, 10, C.dim);
  }
  report.muscles.slice(0, 7).forEach((muscle, index) => {
    const row = y + 38 + index * 18.5;
    draw.text(draw.fit(muscle.muscle, draw.fonts.regular, 9, 82), right + 18, row, draw.fonts.regular, 9, C.text);
    const trackX = right + 104;
    const trackWidth = width - 104 - 44;
    draw.round(trackX, row + 1.5, trackWidth, 6, 3, C.line);
    draw.round(trackX, row + 1.5, Math.max(6, (muscle.sets / most) * trackWidth), 6, 3, index === 0 ? C.lime : hexMix());
    draw.text(`${muscle.sets}`, right + width - 18, row, draw.fonts.semibold, 9, C.muted, { align: 'right' });
  });

  return y + height;
}

function records(draw: Painter, report: TrainingReport, y: number): number {
  const width = W - M * 2;
  const list = report.records.slice(0, 3);
  const height = list.length === 0 ? 50 : 38 + list.length * 19;

  // The one block printed in lime: a record is the best news a report can carry.
  draw.round(M, y, width, height, 14, list.length === 0 ? C.card : C.lime);
  const ink = list.length === 0 ? C.muted : C.limeInk;
  draw.text(list.length === 0 ? 'NEW RECORDS' : `NEW RECORDS  ·  ${report.records.length}`, M + 18, y + 18, draw.fonts.bold, 7.5, ink, { tracking: 1.6 });

  if (list.length === 0) {
    draw.text('None this time. Records come from the weeks you keep showing up.', M + 18, y + 32, draw.fonts.regular, 10, C.dim);
    return y + height;
  }

  list.forEach((record, index) => {
    const row = y + 34 + index * 19;
    draw.star(M + 18, row + 1, 9, C.limeInk);
    draw.text(draw.fit(record.name, draw.fonts.semibold, 11, width - 260), M + 34, row, draw.fonts.semibold, 11, C.limeInk);
    const gainText = record.previousKg === null ? 'first benchmark' : `+${weight(record.oneRepMaxKg - record.previousKg, report.unit)}`;
    draw.text(gainText, W - M - 120, row + 1, draw.fonts.regular, 9.5, C.limeInk, { align: 'right' });
    draw.text(`${weight(record.oneRepMaxKg, report.unit)} est.`, W - M - 18, row, draw.fonts.bold, 11, C.limeInk, { align: 'right' });
  });

  return y + height;
}

/**
 * The coach's notes, in the column beside the hero figure: the page's one
 * paragraph of words, set where the eye lands after the number.
 */
function notes(draw: Painter, report: TrainingReport, y: number): number {
  const x = NOTES_X;
  const width = W - M - x;
  draw.rect(x - 16, y, 0.6, 150, C.line);
  draw.text("COACH'S NOTES", x, y, draw.fonts.semibold, 7.5, C.muted, { tracking: 1.6 });
  let row = y + 18;
  for (const line of report.highlights) {
    draw.rect(x, row + 3.5, 4.5, 4.5, C.lime);
    for (const piece of draw.wrap(line, draw.fonts.regular, 9.5, width - 13)) {
      draw.text(piece, x + 13, row, draw.fonts.regular, 9.5, C.text);
      row += 13.5;
    }
    row += 6;
  }
  return row;
}

function footer(draw: Painter, report: TrainingReport) {
  const y = H - M + 6;
  draw.rect(M, y - 12, W - M * 2, 0.5, C.line);
  const made = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(report.timeZone ? { timeZone: report.timeZone } : {}),
  }).format(new Date(report.generatedAt));
  draw.mark(M, y - 3, 10, C.dim);
  draw.text(`Made with Lift  ·  ${made}`, M + 12, y - 2, draw.fonts.regular, 7.5, C.dim);
  draw.text('Weights in ' + report.unit + '. Max estimates use the Brzycki formula.', W - M, y - 2, draw.fonts.regular, 7.5, C.dim, { align: 'right' });
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function splitTonnage(text: string): [string, string] {
  const space = text.lastIndexOf(' ');
  return space === -1 ? [text, ''] : [text.slice(0, space), text.slice(space + 1)];
}

function weight(kg: number, unit: TrainingReport['unit']): string {
  const value = toUnit(kg, unit);
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 2) / 2;
  return `${rounded} ${unit}`;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

// ---------------------------------------------------------------------------
// Painter
// ---------------------------------------------------------------------------

interface TextOptions {
  align?: 'left' | 'center' | 'right';
  /** Extra space between letters, in points. */
  tracking?: number;
}

class Painter {
  private readonly page: PDFPage;
  readonly fonts: Fonts;

  constructor(page: PDFPage, fonts: Fonts) {
    this.page = page;
    this.fonts = fonts;
  }

  rect(x: number, y: number, width: number, height: number, color: RGB, opacity = 1) {
    this.page.drawRectangle({ x, y: H - y - height, width, height, color, opacity });
  }

  /** A rounded rectangle. pdf-lib has none, so it is an SVG path. */
  round(x: number, y: number, width: number, height: number, radius: number, color: RGB, opacity = 1) {
    this.path(roundedRect(0, 0, width, height, Math.min(radius, width / 2, height / 2)), x, y, color, opacity);
  }

  /** Rounded on the top corners only: a bar standing on a baseline. */
  roundTop(x: number, y: number, width: number, height: number, radius: number, color: RGB) {
    const r = Math.min(radius, width / 2, height);
    const d = `M 0 ${height} L 0 ${r} Q 0 0 ${r} 0 L ${width - r} 0 Q ${width} 0 ${width} ${r} L ${width} ${height} Z`;
    this.path(d, x, y, color);
  }

  path(d: string, x: number, y: number, color: RGB, opacity = 1, scale = 1) {
    this.page.drawSvgPath(d, { x, y: H - y, color, opacity, scale, borderWidth: 0 });
  }

  /** A five-point star, for records. */
  star(x: number, y: number, size: number, color: RGB) {
    const points: string[] = [];
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? size / 2 : size / 4.6;
      points.push(`${(size / 2 + r * Math.cos(angle)).toFixed(2)} ${(size / 2 + r * Math.sin(angle)).toFixed(2)}`);
    }
    this.path(`M ${points.join(' L ')} Z`, x, y, color);
  }

  /**
   * The Lift mark: stem, bar and plate, with the plate's halo cut out of the
   * stem and bar so the two lime shapes stay apart. Same geometry as
   * `scripts/generate-brand.sh`, in its 100-unit space.
   */
  mark(x: number, y: number, height: number, color: RGB, opacity = 1) {
    const s = height / 89;
    const ox = x - 16 * s;
    const oy = y - 8 * s;
    const shape = (rx: number, ry: number, w: number, h: number, r: number, fill: RGB) =>
      this.path(roundedRect(rx, ry, w, h, r), ox, oy, fill, opacity, s);
    shape(16, 8, 22, 68, 7.5, color);
    shape(16, 54, 62, 22, 7.5, color);
    // The seam. Painted in the page colour, which is what the original's mask
    // reveals, so on the ink background it is the same thing.
    if (opacity === 1) shape(52.5, 29.5, 31, 71, 12, C.ink);
    shape(56, 33, 24, 64, 8.5, color);
  }

  width(text: string, font: PDFFont, size: number, tracking = 0): number {
    return font.widthOfTextAtSize(text, size) + Math.max(0, text.length - 1) * tracking;
  }

  /** `y` is the top of the line, as everywhere else here. */
  text(value: string, x: number, y: number, font: PDFFont, size: number, color: RGB, options: TextOptions = {}) {
    const tracking = options.tracking ?? 0;
    const width = this.width(value, font, size, tracking);
    const left = options.align === 'right' ? x - width : options.align === 'center' ? x - width / 2 : x;
    const baseline = H - y - font.heightAtSize(size, { descender: false });

    if (tracking === 0) {
      this.page.drawText(value, { x: left, y: baseline, size, font, color });
      return;
    }
    let cursor = left;
    for (const char of value) {
      this.page.drawText(char, { x: cursor, y: baseline, size, font, color });
      cursor += font.widthOfTextAtSize(char, size) + tracking;
    }
  }

  /** Cuts a line to fit, with an ellipsis. */
  fit(value: string, font: PDFFont, size: number, max: number): string {
    if (this.width(value, font, size) <= max) return value;
    let cut = value;
    while (cut.length > 1 && this.width(`${cut}…`, font, size) > max) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  }

  wrap(value: string, font: PDFFont, size: number, max: number): string[] {
    const lines: string[] = [];
    let current = '';
    for (const word of value.split(/\s+/)) {
      const next = current ? `${current} ${word}` : word;
      if (this.width(next, font, size) > max && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    return lines;
  }
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  return [
    `M ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `L ${x + w} ${y + h - r}`,
    `Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
    `L ${x + r} ${y + h}`,
    `Q ${x} ${y + h} ${x} ${y + h - r}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    'Z',
  ].join(' ');
}
