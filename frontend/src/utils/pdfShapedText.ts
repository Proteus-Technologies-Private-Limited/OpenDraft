/**
 * Drawing HarfBuzz output through jsPDF.
 *
 * `utils/textShaping` says which glyphs to draw and where. jsPDF has no way to
 * be told a glyph: it looks characters up in the font's `cmap`, and a Tamil கு
 * or a Hindi क्ष has no character there. So each shaped glyph is given one — a
 * Private Use code point, U+E000 plus its glyph id — entered into jsPDF's
 * in-memory copy of the `cmap`. jsPDF's own encoder then turns those into the
 * glyph ids HarfBuzz chose, embeds them in the subset and records their widths
 * exactly as it would for any other text.
 *
 * The run itself is written here, as one text object with a single `TJ`, not
 * through `text()`. HarfBuzz positions glyphs as well as choosing them — a
 * mark's offset over its base, a kerning pair — and `text()` can only place a
 * string at its default advances. Splitting a run into several `text()` calls
 * wherever a position differs did place the glyphs right, but every split is a
 * seam where text extraction inserts a space or loses its place. A `TJ` array
 * carries the horizontal adjustments inline, `Ts` the vertical ones, and the
 * run stays one string to everything that reads it back.
 *
 * What that leaves is the text layer. jsPDF writes a ToUnicode map from glyph
 * to the character it was asked for, which would now be a private-use code
 * point that copies out as nothing, and it can only write one character per
 * glyph where a ligature stands for several. Two things put it right:
 *
 * - **A ToUnicode map of our own** for the shaped fonts, mapping every glyph
 *   to the text it was shaped from — கு back to க + ு. jsPDF's own font writer
 *   is stood aside for those fonts only (see `enableShapedOutput`).
 * - **ActualText** around each cluster whose glyphs do not spell it. A glyph
 *   map can only give text back in the order it is drawn, and போ is drawn
 *   ே-ப-ா; wrapped, it copies and searches as typed in the readers that honour
 *   ActualText (Acrobat, PDFium, MuPDF), and the rest fall back on the map.
 *   Per cluster rather than per run, as Chrome's own PDF backend does it:
 *   MuPDF drops out of a span at the first TJ adjustment and then prints the
 *   remaining glyphs a second time, which a run-long span walks straight into.
 */
import type jsPDF from 'jspdf';
import type { ShapingFont, ShapedGlyph } from './textShaping';

const PUA_START = 0xe000;
const PUA_END = 0xf8ff;

/** One glyph of a shaped run, as it will be written. */
export interface PlacedGlyph {
  /** The private-use character that addresses it. */
  char: string;
  /** UTF-16 offset of the cluster it belongs to, in the run's source. */
  cluster: number;
  /** Where it is drawn, in thousandths of an em from the run's origin; y is up. */
  x: number;
  y: number;
  /** The advance a PDF reader will give it: the /W entry jsPDF writes. */
  width: number;
}

/** A piece of text shaped in the current face, ready to draw at any size. */
export interface ShapedRun {
  glyphs: PlacedGlyph[];
  /** Total advance in thousandths of an em. */
  advance: number;
  /**
   * The clusters whose glyphs' ToUnicode text would not read back as typed,
   * by cluster offset, with the text they were typed as.
   */
  actualText: Map<number, string>;
}

/** A jsPDF font that HarfBuzz shapes for. */
interface Binding {
  shaping: ShapingFont;
  /** ISO 15924 script tag the face is shaped as. */
  script: string;
}

/** Per jsPDF font: what is needed to address and describe its glyphs. */
interface FontState {
  /** Glyph id → the code point the font's own cmap maps to it. */
  nominal: Map<number, number>;
  /** Glyph id → the text it stands for, as first shaped. */
  glyphText: Map<number, string>;
  /** Shaped runs by source text, so measuring then drawing shapes once. */
  runs: Map<string, ShapedRun | null>;
}

/** jsPDF's TTFFont, for the parts of it this module reaches into. */
interface TtfMetadata {
  cmap: { unicode: { codeMap: Record<number, number> } };
  widthOfGlyph(gid: number): number;
  toUnicode: Record<number, number>;
  glyIdsUsed: number[];
  Unicode: { widths: unknown[] };
  subset: { encode(glyphs: number[], indexToLocFormat: number): ArrayLike<number> };
  bbox: unknown;
  flags: number;
  stemV: number;
  italicAngle: number;
  ascender: number;
  decender: number;
  capHeight: number;
}

interface JsPdfFont {
  fontName: string;
  encoding: string;
  metadata: TtfMetadata;
  objectNumber?: number;
  isAlreadyPutted?: boolean;
}

const bindings = new WeakMap<TtfMetadata, Binding>();
/** The shaped fonts each document has, for writing them out. */
const documentFonts = new WeakMap<jsPDF, JsPdfFont[]>();
const states = new WeakMap<TtfMetadata, FontState>();

function stateFor(metadata: TtfMetadata): FontState {
  let state = states.get(metadata);
  if (!state) {
    const nominal = new Map<number, number>();
    for (const [code, gid] of Object.entries(metadata.cmap.unicode.codeMap)) {
      const codePoint = Number(code);
      if (codePoint >= PUA_START && codePoint <= PUA_END) continue;
      // The lowest code point wins where two share a glyph (space and NBSP).
      if (gid && !nominal.has(gid)) nominal.set(gid, codePoint);
    }
    state = { nominal, glyphText: new Map(), runs: new Map() };
    states.set(metadata, state);
  }
  return state;
}

/**
 * Shape whatever is drawn in `fontName`/`style` with `shaping`. Called once per
 * registered style, straight after `addFont`.
 */
export function bindShapingFont(
  pdf: jsPDF,
  fontName: string,
  style: string,
  shaping: ShapingFont,
  script: string,
): void {
  const previous = pdf.getFont();
  try {
    pdf.setFont(fontName, style);
    const font = pdf.getFont() as unknown as JsPdfFont;
    if (font.encoding !== 'Identity-H' || !font.metadata?.cmap) return;
    bindings.set(font.metadata, { shaping, script });
    const shaped = documentFonts.get(pdf) ?? [];
    if (!shaped.includes(font)) shaped.push(font);
    documentFonts.set(pdf, shaped);
    enableShapedOutput(pdf);
  } finally {
    pdf.setFont(previous.fontName, previous.fontStyle);
  }
}

/** Whether the face currently set is one HarfBuzz shapes for. */
export function isShapedFace(pdf: jsPDF): boolean {
  const font = pdf.getFont() as unknown as JsPdfFont;
  return !!font.metadata && bindings.has(font.metadata);
}

/**
 * The text each glyph of one shaped run stands for.
 *
 * A glyph the font's cmap maps from a character stands for that character —
 * always, so the map stays consistent wherever the glyph is reused. Whatever
 * the cluster typed that no such glyph accounts for goes to its first glyph
 * that is not anyone's nominal glyph: the ligature, the conjunct, the reph.
 */
function describeGlyphs(state: FontState, glyphs: ShapedGlyph[], source: string): Map<number, string> {
  const starts = [...new Set(glyphs.map((glyph) => glyph.cluster))].sort((a, b) => a - b);
  const endOf = (cluster: number) => {
    const next = starts.find((start) => start > cluster);
    return next ?? source.length;
  };

  const byCluster = new Map<number, ShapedGlyph[]>();
  for (const glyph of glyphs) {
    const list = byCluster.get(glyph.cluster);
    if (list) list.push(glyph);
    else byCluster.set(glyph.cluster, [glyph]);
  }

  const typed = new Map<number, string>();
  for (const [cluster, members] of byCluster) {
    typed.set(cluster, source.slice(cluster, endOf(cluster)));
    // Compared decomposed: फ़ typed as फ + nukta is drawn with the glyph the
    // font maps from the precomposed U+095E, and HarfBuzz composes and
    // decomposes freely on its way to the glyphs.
    const remaining = [...source.slice(cluster, endOf(cluster)).normalize('NFD')];
    for (const glyph of members) {
      const nominal = state.nominal.get(glyph.gid);
      if (nominal === undefined) continue;
      const parts = [...String.fromCodePoint(nominal).normalize('NFD')];
      if (!parts.every((part) => remaining.includes(part))) continue;
      for (const part of parts) remaining.splice(remaining.indexOf(part), 1);
    }

    let leftoverTaken = false;
    for (const glyph of members) {
      if (state.glyphText.has(glyph.gid)) continue;
      const nominal = state.nominal.get(glyph.gid);
      if (nominal !== undefined) {
        state.glyphText.set(glyph.gid, String.fromCodePoint(nominal));
      } else if (!leftoverTaken) {
        state.glyphText.set(glyph.gid, remaining.join('').normalize('NFC'));
        leftoverTaken = true;
      }
    }
  }
  return typed;
}

/**
 * Shape `text` in the face currently set, or null when that face is not
 * shaped or the shaping cannot be drawn — the caller then draws it unshaped.
 */
export function layoutShaped(pdf: jsPDF, text: string): ShapedRun | null {
  const font = pdf.getFont() as unknown as JsPdfFont;
  const metadata = font.metadata;
  const binding = metadata && bindings.get(metadata);
  if (!binding) return null;

  const state = stateFor(metadata);
  if (state.runs.has(text)) return state.runs.get(text)!;

  let run: ShapedRun | null = null;
  try {
    run = buildRun(metadata, state, binding, text);
  } catch (error) {
    console.warn('[pdfShapedText] shaping failed; drawing unshaped', error);
  }
  state.runs.set(text, run);
  return run;
}

function buildRun(metadata: TtfMetadata, state: FontState, binding: Binding, text: string): ShapedRun | null {
  const glyphs = binding.shaping.shape(text, binding.script);
  // Glyph 0 is .notdef, and jsPDF stops writing a string at the first one —
  // the rest of the line would vanish. Nothing in a face's coverage should
  // shape to it; if something does, the glyph is dropped, not the line.
  const drawable = glyphs.filter((glyph) => glyph.gid > 0);
  if (drawable.length !== glyphs.length) {
    console.warn('[pdfShapedText] dropped glyphs the face has no outline for', text);
  }
  if (drawable.some((glyph) => PUA_START + glyph.gid > PUA_END)) return null;

  const typed = describeGlyphs(state, drawable, text);

  const codeMap = metadata.cmap.unicode.codeMap;
  const toEm = 1000 / binding.shaping.upem;
  const placed: PlacedGlyph[] = [];
  let pen = 0;
  for (const glyph of drawable) {
    codeMap[PUA_START + glyph.gid] = glyph.gid;
    placed.push({
      char: String.fromCharCode(PUA_START + glyph.gid),
      cluster: glyph.cluster,
      x: (pen + glyph.xOffset) * toEm,
      y: glyph.yOffset * toEm,
      // jsPDF truncates the /W entries it writes to whole thousandths, and
      // those are what a reader advances by.
      width: parseInt(String(metadata.widthOfGlyph(glyph.gid)), 10) || 0,
    });
    pen += glyph.xAdvance;
  }

  // What each cluster will copy out as through the ToUnicode map, against what
  // was typed. Glyph text is settled the first time a glyph is described and
  // never changes, so this is what the file will say.
  const reads = new Map<number, string>();
  for (const glyph of drawable) {
    reads.set(glyph.cluster, (reads.get(glyph.cluster) ?? '') + (state.glyphText.get(glyph.gid) ?? ''));
  }
  const actualText = new Map<number, string>();
  for (const [cluster, source] of typed) {
    if (reads.get(cluster)?.normalize('NFD') !== source.normalize('NFD')) actualText.set(cluster, source);
  }

  return { glyphs: placed, advance: pen * toEm, actualText };
}

/** UTF-16BE hex with a byte-order mark, for a PDF text string. */
function utf16Hex(text: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  }
  return hex;
}

/** jsPDF's internals this module writes through. */
interface JsPdfInternals {
  internal: {
    write(text: string): void;
    getCoordinateString(x: number): string;
    getVerticalCoordinateString(y: number): string;
  };
}

/**
 * The jsPDF plugin functions this module uses. jsPDF copies every plugin onto
 * each document it makes, so they are reached through the document — which
 * also keeps this module from loading jsPDF itself.
 */
interface JsPdfPlugins {
  pdfEscape16(text: string, font: JsPdfFont): string;
  PDFObject: { convert(value: unknown): string };
}

const plugins = (pdf: jsPDF) => pdf as unknown as JsPdfPlugins;

/** A number as the content stream writes it: three places, no trailing zeros. */
function num(value: number): string {
  const fixed = value.toFixed(3);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return trimmed === '-0' ? '0' : trimmed;
}

/** The text colour as a fill operator, the way jsPDF's own `text()` sets it. */
function fillOperator(pdf: jsPDF): string {
  const hex = String(pdf.getTextColor() ?? '#000000').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '0 g';
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  return r === g && g === b ? `${num(r)} g` : `${num(r)} ${num(g)} ${num(b)} rg`;
}

/**
 * Draw a shaped run with its baseline origin at (x, y), in the current face,
 * size and colour, and return its width in points.
 */
export function drawShaped(pdf: jsPDF, run: ShapedRun, x: number, y: number): number {
  const font = pdf.getFont() as unknown as JsPdfFont & { id: string };
  const size = pdf.getFontSize();
  const { internal } = pdf as unknown as JsPdfInternals;
  const { pdfEscape16 } = plugins(pdf);

  // One TJ array per stretch at the same height; Ts lifts or drops a stretch
  // whose marks GPOS moved vertically. `cursor` is where the reader's pen is,
  // having advanced by each glyph's default width.
  const ops: string[] = [];
  let array: string[] = [];
  let rise = 0;
  let cursor = 0;
  let inSpan = false;
  const flush = () => {
    if (array.length) ops.push(`[${array.join(' ')}] TJ`);
    array = [];
  };
  run.glyphs.forEach((glyph, index) => {
    // A cluster that reads back wrong is shown in a TJ of its own, inside an
    // ActualText span — marked content cannot open inside a TJ array.
    if (index === 0 || run.glyphs[index - 1].cluster !== glyph.cluster) {
      if (inSpan) {
        flush();
        ops.push('EMC');
        inSpan = false;
      }
      const actual = run.actualText.get(glyph.cluster);
      if (actual !== undefined) {
        flush();
        ops.push(`/Span <</ActualText <${utf16Hex(actual)}>>> BDC`);
        inSpan = true;
      }
    }
    if (glyph.y !== rise) {
      flush();
      rise = glyph.y;
      ops.push(`${num((rise * size) / 1000)} Ts`);
    }
    const shift = glyph.x - cursor;
    // TJ subtracts its numbers from the position, in thousandths of an em.
    if (Math.abs(shift) >= 0.01) array.push(num(-shift));
    array.push(`<${pdfEscape16(glyph.char, font)}>`);
    cursor = glyph.x + glyph.width;
  });
  flush();
  if (inSpan) ops.push('EMC');
  if (rise !== 0) ops.push('0 Ts');

  internal.write([
    'BT',
    `/${font.id} ${num(size)} Tf`,
    fillOperator(pdf),
    // Character spacing is text state, which outlives the text object: a
    // Courier run before this one leaves its cell spacing set.
    '0 Tc',
    `${internal.getCoordinateString(x)} ${internal.getVerticalCoordinateString(y)} Td`,
    ...ops,
    'ET',
  ].join('\n'));
  return (run.advance * size) / 1000;
}

/** A shaped run's width in points at the current size. */
export function shapedWidth(pdf: jsPDF, run: ShapedRun): number {
  return (run.advance * pdf.getFontSize()) / 1000;
}

/**
 * The run as one string for jsPDF to draw itself — for text that is rotated,
 * like the watermark. The glyphs are the shaped ones; their GPOS adjustments
 * are not carried, which a watermark can spare.
 */
export function shapedAsString(run: ShapedRun): string {
  return run.glyphs.map((glyph) => glyph.char).join('');
}

// ── Writing the shaped fonts ────────────────────────────────────────────────

/** Marks a shaped font while the document is written, so jsPDF passes it by. */
const SHAPED_ENCODING = 'Identity-H-Shaped';

const enabled = new WeakSet<object>();

function toUnicodeCmap(metadata: TtfMetadata, state: FontState | undefined): string {
  const entries: string[] = [];
  const gids = Object.keys(metadata.toUnicode).map(Number).sort((a, b) => a - b);
  for (const gid of gids) {
    let text = state?.glyphText.get(gid);
    if (text === undefined) {
      const code = metadata.toUnicode[gid];
      text = code >= PUA_START && code <= PUA_END
        ? (state?.nominal.has(gid) ? String.fromCodePoint(state.nominal.get(gid)!) : '')
        : String.fromCharCode(code);
    }
    if (!text) continue;
    entries.push(`<${gid.toString(16).padStart(4, '0')}><${utf16Hex(text).slice(4)}>`);
  }

  let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n'
    + '/CIDSystemInfo <<\n  /Registry (Adobe)\n  /Ordering (UCS)\n  /Supplement 0\n>> def\n'
    + '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n'
    + '1 begincodespacerange\n<0000><ffff>\nendcodespacerange';
  for (let i = 0; i < entries.length; i += 100) {
    const block = entries.slice(i, i + 100);
    cmap += `\n${block.length} beginbfchar\n${block.join('\n')}\nendbfchar`;
  }
  cmap += '\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  return cmap;
}

interface PutFontArgs {
  font: JsPdfFont;
  out: (line: string) => void;
  newObject: () => number;
  putStream: (options: { data: string; addLength1?: boolean; objectId?: number }) => void;
}

/** A PDF name with anything outside the regular characters escaped. */
function pdfName(name: string): string {
  return name.replace(/[^\x21-\x7e]|[#()<>[\]{}/%]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/**
 * Write one shaped font: jsPDF's own Identity-H Type 0 font, unchanged except
 * for the ToUnicode map, which carries each glyph's real text.
 */
function putShapedFont(
  { font, out, newObject, putStream }: PutFontArgs,
  convert: (value: unknown) => string,
): void {
  const metadata = font.metadata;
  const subset = metadata.subset.encode(metadata.glyIdsUsed, 1);
  let program = '';
  for (let i = 0; i < subset.length; i++) program += String.fromCharCode(subset[i]);

  const fontFile = newObject();
  putStream({ data: program, addLength1: true, objectId: fontFile });
  out('endobj');

  const cmap = newObject();
  putStream({ data: toUnicodeCmap(metadata, states.get(metadata)), addLength1: true, objectId: cmap });
  out('endobj');

  const name = pdfName(font.fontName);

  const descriptor = newObject();
  out('<<');
  out('/Type /FontDescriptor');
  out(`/FontName /${name}`);
  out(`/FontFile2 ${fontFile} 0 R`);
  out(`/FontBBox ${convert(metadata.bbox)}`);
  out(`/Flags ${metadata.flags}`);
  out(`/StemV ${metadata.stemV}`);
  out(`/ItalicAngle ${metadata.italicAngle}`);
  out(`/Ascent ${metadata.ascender}`);
  out(`/Descent ${metadata.decender}`);
  out(`/CapHeight ${metadata.capHeight}`);
  out('>>');
  out('endobj');

  const descendant = newObject();
  out('<<');
  out('/Type /Font');
  out(`/BaseFont /${name}`);
  out(`/FontDescriptor ${descriptor} 0 R`);
  out(`/W ${convert(metadata.Unicode.widths)}`);
  out('/CIDToGIDMap /Identity');
  out('/DW 1000');
  out('/Subtype /CIDFontType2');
  out('/CIDSystemInfo');
  out('<<');
  out('/Supplement 0');
  out('/Registry (Adobe)');
  out('/Ordering (Identity-H)');
  out('>>');
  out('>>');
  out('endobj');

  font.objectNumber = newObject();
  out('<<');
  out('/Type /Font');
  out('/Subtype /Type0');
  out(`/ToUnicode ${cmap} 0 R`);
  out(`/BaseFont /${name}`);
  out('/Encoding /Identity-H');
  out(`/DescendantFonts [${descendant} 0 R]`);
  out('>>');
  out('endobj');
  font.isAlreadyPutted = true;
}

/**
 * Have this document write its shaped fonts with their real text.
 *
 * jsPDF writes every Identity-H font itself, in a `putFont` handler that runs
 * before any a document subscribes. So the shaped fonts are given a different
 * encoding name for as long as the file is being written — jsPDF's handler
 * passes them by, this one writes them — and handed back afterwards so the
 * document can still be drawn in or written again.
 */
function enableShapedOutput(pdf: jsPDF): void {
  if (enabled.has(pdf)) return;
  enabled.add(pdf);

  const events = (pdf.internal as unknown as {
    events: { subscribe(topic: string, callback: (...args: unknown[]) => void): string };
  }).events;

  let writing: JsPdfFont[] = [];
  events.subscribe('buildDocument', () => {
    writing = (documentFonts.get(pdf) ?? []).filter((font) => font.encoding === 'Identity-H');
    for (const font of writing) font.encoding = SHAPED_ENCODING;
  });
  events.subscribe('putFont', (args) => {
    const put = args as PutFontArgs;
    if (put.font.encoding === SHAPED_ENCODING) putShapedFont(put, plugins(pdf).PDFObject.convert);
  });
  events.subscribe('postPutResources', () => {
    for (const font of writing) font.encoding = 'Identity-H';
    writing = [];
  });
}
