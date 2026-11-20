/**
 * Line spacing — how far apart the lines of a script are drawn.
 *
 * The page is laid out in 12pt lines, six to the inch (16px on screen), which
 * is Final Draft's standard pitch. A template can open that up in two ways:
 *
 *  - `lineSpacing`, one value for the whole script (Format › Line Spacing, or
 *    the Template Editor). Standard is 1.
 *  - `lineHeightMultiplier`, per element (the Multi-Cam Sitcom double-spaces
 *    its dialogue).
 *
 * An element's lines are drawn `multiplier × 12pt` apart, where the multiplier
 * is the two multiplied together. The blank lines *between* elements (space
 * before) stay whole 12pt lines, as Final Draft's own `SpaceBefore` does — line
 * spacing opens up the text, not the gaps the template already chose.
 *
 * Every consumer — the editor's pagination, the page CSS, the scene navigator,
 * the PDF, DOCX and FDX exporters — reads the multiplier from here, so the page
 * turns in the same place in all of them.
 *
 * ## Why steps of an eighth
 *
 * The editor is one continuous column. Each page break is a margin computed as
 * `(lines left on the page) × 16px`, and the DOM has to have laid the text out
 * at exactly that pitch or the break drifts off the page edge — by a little per
 * page, adding up over a script. A multiplier of k/8 gives a pitch of 2k px on
 * screen, 1.5k pt in the PDF and 30k twips in Word: whole numbers everywhere,
 * and k/8 is exact in binary floating point, so a page's line count adds up
 * without rounding error however many fractional lines it holds. Any other
 * fraction (1.15, say) would put a fractional pixel into every line. So the
 * multiplier is always rounded to the nearest eighth, here, once.
 */

import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { elementIdOf, type BreakableNode } from './pageBreaks';
import type { FormattingTemplate } from '../stores/formattingTypes';

/** One step of the fine control: an eighth of a line, 2px on screen. */
export const LINE_SPACING_STEP = 0.125;
/** Standard pitch, six lines to the inch. The default, and the minimum. */
export const STANDARD_LINE_SPACING = 1;
/** Double spacing — as open as the script-wide setting goes. */
export const MAX_LINE_SPACING = 2;
/**
 * The widest an element's lines may be drawn, script-wide spacing and
 * per-element multiplier together (sitcom dialogue at 2 under Open is 2.5).
 */
const MAX_EFFECTIVE_MULTIPLIER = 4;

/** The named settings offered beside the fine control. */
export const LINE_SPACING_PRESETS = [
  { id: 'standard', value: 1 },
  { id: 'slightlyOpen', value: 1.125 },
  { id: 'open', value: 1.25 },
] as const;

export type LineSpacingPresetId = (typeof LINE_SPACING_PRESETS)[number]['id'];

/**
 * Node types that never take line spacing. Each is laid out on a grid of its
 * own rather than as wrapped lines of one paragraph:
 *  - the title page is positioned by counting its 12pt spacer lines;
 *  - dual dialogue is measured row by row, both columns at once;
 *  - an AV body is a table with its own row pagination;
 *  - an image has a height, not lines;
 *  - Sections and Notes never reach the page at all.
 */
const EXEMPT_TYPES: ReadonlySet<string> = new Set([
  'titlePage', 'dualDialogue', 'avBlock', 'screenplayImage', 'section', 'note',
]);

/** Does this node type ever take line spacing? */
export function takesLineSpacing(typeName: string | undefined | null): boolean {
  return !!typeName && !EXEMPT_TYPES.has(typeName);
}

const toEighth = (value: number): number => Math.round(value / LINE_SPACING_STEP) * LINE_SPACING_STEP;

/**
 * A stored script-wide line spacing, made safe to lay out with: missing or
 * malformed means Standard, and anything else is clamped to the offered range
 * and rounded to the nearest eighth.
 */
export function normalizeLineSpacing(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return STANDARD_LINE_SPACING;
  const clamped = Math.min(MAX_LINE_SPACING, Math.max(STANDARD_LINE_SPACING, value));
  return toEighth(clamped);
}

/**
 * The multiplier an element's lines are drawn at: its own (if the template
 * gives it one) times the script-wide spacing, rounded to an eighth.
 *
 * Never tighter than one line per 12pt — 12pt Courier does not fit in less.
 */
export function effectiveLineMultiplier(perElement: unknown, lineSpacing: unknown): number {
  const own = typeof perElement === 'number' && Number.isFinite(perElement) && perElement > 0 ? perElement : 1;
  const product = own * normalizeLineSpacing(lineSpacing);
  return Math.min(MAX_EFFECTIVE_MULTIPLIER, Math.max(1, toEighth(product)));
}

/** What a template says about line spacing — the subset this module reads. */
export interface LineSpacingSource {
  lineSpacing?: number;
  lineHeightMultiplier?: Record<string, number>;
}

/**
 * The multiplier for one element, by node type and template element id.
 * `typeName` decides exemption; `elementId` (a custom element's template id,
 * otherwise the type) looks up the per-element value.
 */
export function lineMultiplierFor(
  source: LineSpacingSource | null | undefined,
  typeName: string,
  elementId: string = typeName,
): number {
  if (!takesLineSpacing(typeName)) return 1;
  return effectiveLineMultiplier(source?.lineHeightMultiplier?.[elementId], source?.lineSpacing);
}

/** Line spacing as an exporter lays a page out with it. */
export interface LineSpacingResolver {
  /** The multiplier for one node (1 for every exempt type). */
  multiplierOf: (node: BreakableNode) => number;
  /**
   * True when nothing in the template opens a line up — every element is drawn
   * at 12pt. Exporters keep their long-standing layout exactly in that case.
   */
  standard: boolean;
}

/** Does anything in this template draw a line at other than 12pt? */
export function isStandardLineSpacing(source: LineSpacingSource | null | undefined): boolean {
  if (!source) return true;
  if (normalizeLineSpacing(source.lineSpacing) !== STANDARD_LINE_SPACING) return false;
  return Object.values(source.lineHeightMultiplier ?? {})
    .every((value) => effectiveLineMultiplier(value, STANDARD_LINE_SPACING) === 1);
}

/** Line spacing for a given template (or Standard for none). */
export function lineSpacingResolver(source: LineSpacingSource | null | undefined): LineSpacingResolver {
  return {
    multiplierOf: (node) => lineMultiplierFor(source, node.type || 'general', elementIdOf(node)),
    standard: isStandardLineSpacing(source),
  };
}

/**
 * Line spacing for the active template — what the PDF and DOCX exporters lay a
 * page out with.
 *
 * Read lazily and defensively, like `getSpaceBefore` and `getForceBreakIds`:
 * an exporter must still produce a document when the template store has not
 * been hydrated (tests, headless export). Falls back to Standard.
 */
export function getLineSpacing(): LineSpacingResolver {
  try {
    return lineSpacingResolver(useFormattingTemplateStore.getState().getActiveTemplate());
  } catch (err) {
    console.warn('[lineSpacing] could not read the template line spacing, using standard', err);
    return lineSpacingResolver(null);
  }
}

/**
 * A multiplier as Final Draft writes `Spacing` on a ParagraphSpec: "1", "1.5",
 * "2". Eighths need at most three decimals.
 */
export function fdxSpacing(multiplier: number): string {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return '1';
  return String(Math.round(multiplier * 1000) / 1000);
}

/** What an .fdx's element settings say about line spacing. */
export interface ImportedLineSpacing {
  /** Script-wide spacing — the Action element's, which is the base of a script. */
  lineSpacing: number;
  /** Elements drawn at other than that, relative to it (sitcom dialogue: 2). */
  lineHeightMultiplier: Record<string, number>;
}

/**
 * Turn the `Spacing` of each element an .fdx defines into a script-wide value
 * plus per-element multipliers, or null when everything is single-spaced — the
 * common case, which must import exactly as it always has.
 *
 * `spacings` is keyed by OpenDraft element id; values are Final Draft's raw
 * attribute text. Unreadable values count as single.
 */
export function importedLineSpacing(spacings: Record<string, string | null | undefined>): ImportedLineSpacing | null {
  const read = (raw: string | null | undefined): number => {
    const n = raw == null ? NaN : Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };
  const base = normalizeLineSpacing(read(spacings.action));
  const lineHeightMultiplier: Record<string, number> = {};
  for (const [id, raw] of Object.entries(spacings)) {
    if (id === 'action') continue;
    const own = effectiveLineMultiplier(read(raw) / base, STANDARD_LINE_SPACING);
    if (own !== 1) lineHeightMultiplier[id] = own;
  }
  if (base === STANDARD_LINE_SPACING && Object.keys(lineHeightMultiplier).length === 0) return null;
  return { lineSpacing: base, lineHeightMultiplier };
}

/**
 * The template with this line spacing — the key left out at Standard, so a
 * format set back to Standard is exactly the format it was before it was
 * opened up (and compares equal to it).
 */
export function withLineSpacing(template: FormattingTemplate, spacing: number): FormattingTemplate {
  const value = normalizeLineSpacing(spacing);
  const next: FormattingTemplate = { ...template, updatedAt: new Date().toISOString() };
  if (value === STANDARD_LINE_SPACING) delete next.lineSpacing;
  else next.lineSpacing = value;
  return next;
}

/** The preset a value matches exactly, or null for a value set on the fine control. */
export function presetFor(value: number): LineSpacingPresetId | null {
  const found = LINE_SPACING_PRESETS.find((p) => p.value === normalizeLineSpacing(value));
  return found ? found.id : null;
}

/**
 * A line spacing as a writer reads it, "1.25", and the pitch it gives, "15"
 * (points per line). Locale-aware decimals, never more than three places —
 * every value is an eighth, so neither needs more.
 */
export function formatLineSpacing(value: number, locale?: string): { value: string; points: string } {
  const spacing = normalizeLineSpacing(value);
  const format = (n: number): string => {
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(n);
    } catch (err) {
      // An unknown locale tag must not break the dialog; plain digits will do.
      console.warn('[lineSpacing] could not format a number for this locale', err);
      return String(n);
    }
  };
  return { value: format(spacing), points: format(spacing * 12) };
}
