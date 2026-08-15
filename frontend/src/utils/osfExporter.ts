/**
 * Open Screenplay Format (.osf) and Fade In (.fadein) writer.
 *
 * The counterpart to osfParser, and deliberately its mirror image: everything
 * written here is something the parser reads back, because the first user of
 * this exporter is OpenDraft itself saving a Fade In file it opened.
 *
 * OSF revision 3.0 is the target. Its `basestylename` spelling is what the
 * parser prefers and what Fade In 3.x and 4.x both accept — 4.0's shortened
 * `basestyle` is newer but buys nothing here, and 1.2/2.x are older than any
 * reader still in use.
 *
 * What round-trips: element types, inline bold/italic/underline/strikethrough,
 * colour and highlight, per-run font and size, hard line breaks, alignment,
 * forced page breaks, scene numbers, synopses, dual dialogue, and the title
 * page. What does not: OpenDraft's own additions — notes, tags, beats,
 * character profiles — which the format has nowhere to put. They stay in the
 * .odraft copy, and the exporter does not pretend otherwise.
 */
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/react';
import { sanitizeExportFilename } from './exportFilename';

/** Element type → the OSF style a paragraph is based on. */
const NODE_TO_OSF_STYLE: Record<string, string> = {
  sceneHeading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
  shot: 'Shot',
  general: 'Normal Text',
  lyrics: 'Lyrics',
  // OSF has no equivalent for these, and a paragraph whose style cannot be
  // resolved reads back as Action — which would silently change the script.
  // Normal Text is the format's own "no particular element" style, so it is
  // the honest landing place.
  newAct: 'Normal Text',
  endOfAct: 'Normal Text',
  showEpisode: 'Normal Text',
  castList: 'Normal Text',
};

/** The eight built-in styles, in the order the format fixes them. */
const BUILTIN_STYLES: { name: string; index: number; extra?: string }[] = [
  { name: 'Normal Text', index: 0 },
  { name: 'Scene Heading', index: 1, extra: ' spacebefore="2.0" keepwithnext="1" allcaps="1"' },
  { name: 'Action', index: 2, extra: ' spacebefore="1.0"' },
  { name: 'Character', index: 3, extra: ' spacebefore="1.0" keepwithnext="1" leftindent="635" allcaps="1"' },
  { name: 'Parenthetical', index: 4, extra: ' keepwithnext="1" leftindent="508" rightindent="508"' },
  { name: 'Dialogue', index: 5, extra: ' leftindent="254" rightindent="254"' },
  { name: 'Transition', index: 6, extra: ' spacebefore="1.0" align="right" allcaps="1"' },
  { name: 'Shot', index: 7, extra: ' spacebefore="1.0" allcaps="1"' },
];

/** Title-page field → the bookmark the parser reads it back from. */
const TP_ATTR_TO_BOOKMARK: [string, string][] = [
  ['tpTitle', 'title'],
  ['tpBasedOn', 'subtitle'],
  ['tpWrittenBy', 'author'],
  ['tpDraft', 'draft'],
  ['tpContact', 'contact'],
  ['tpCopyright', 'copyright'],
  ['tpNotes', 'notes'],
];

export interface OSFExportOptions {
  /** Typeface the document is written in; goes on the styles, as OSF wants. */
  font?: { family?: string; size?: string };
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Escape for element content, keeping newlines as entities.
 *
 * A newline inside <text> is how OSF carries a line break within a paragraph.
 * Writing it raw invites any pretty-printer between here and the reader to
 * collapse it into a space, taking the break with it.
 */
function escText(value: string): string {
  return esc(value).replace(/\r\n?|\n/g, '&#10;');
}

/** A colour mark as OSF writes it: six hex digits, no leading hash. */
function osfColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(hex)) return hex.toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return hex
      .split('')
      .map((c) => c + c)
      .join('')
      .toUpperCase();
  }
  return null;
}

/** Attributes for one run of text, from its Tiptap marks. */
function runAttributes(marks: JSONContent['marks']): string {
  if (!marks || marks.length === 0) return '';

  let out = '';
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        out += ' bold="1"';
        break;
      case 'italic':
        out += ' italic="1"';
        break;
      case 'underline':
        out += ' underline="1"';
        break;
      case 'strike':
        out += ' strikethrough="1"';
        break;
      case 'highlight': {
        const color = osfColor((mark.attrs as { color?: unknown } | undefined)?.color);
        if (color) out += ` bgcolor="${color}"`;
        break;
      }
      case 'textStyle': {
        const attrs = (mark.attrs ?? {}) as {
          color?: unknown;
          fontFamily?: unknown;
          fontSize?: unknown;
        };
        const color = osfColor(attrs.color);
        if (color) out += ` color="${color}"`;
        if (typeof attrs.fontFamily === 'string' && attrs.fontFamily.trim() !== '') {
          out += ` font="${esc(attrs.fontFamily.trim())}"`;
        }
        if (typeof attrs.fontSize === 'string') {
          const size = attrs.fontSize.replace(/pt$/i, '').trim();
          if (size !== '') out += ` size="${esc(size)}"`;
        }
        break;
      }
      default:
        // Marks OSF has no room for (comments, track changes) are dropped
        // rather than written as something a reader would misinterpret.
        break;
    }
  }
  return out;
}

/**
 * The <text> runs of one paragraph.
 *
 * A hard break becomes a run holding a single newline: the parser turns any
 * newline inside <text> back into a hardBreak node, and a run of its own keeps
 * the break from picking up the formatting of the text on either side.
 */
function textRuns(node: JSONContent, stripBrackets: boolean): string {
  const children = node.content ?? [];
  const runs: string[] = [];

  // Collected first so the bracket strip can see the whole paragraph: a
  // parenthetical's "(" and ")" may sit on different runs.
  const parts: { text: string; attrs: string }[] = [];
  for (const child of children) {
    if (child.type === 'hardBreak') {
      parts.push({ text: '\n', attrs: '' });
      continue;
    }
    if (child.type !== 'text' || typeof child.text !== 'string') continue;
    parts.push({ text: child.text, attrs: runAttributes(child.marks) });
  }

  if (stripBrackets) {
    const textual = parts.filter((p) => p.text !== '\n');
    if (textual.length > 0) {
      const first = textual[0];
      const last = textual[textual.length - 1];
      const flat = textual.map((p) => p.text).join('');
      // OSF stores a parenthetical bare and leaves the brackets to the
      // renderer; the parser puts them back on the way in.
      if (flat.trim().startsWith('(') && flat.trim().endsWith(')')) {
        first.text = first.text.replace(/^(\s*)\(/, '$1');
        last.text = last.text.replace(/\)(\s*)$/, '$1');
      }
    }
  }

  for (const part of parts) {
    if (part.text === '') continue;
    runs.push(`        <text${part.attrs}>${escText(part.text)}</text>`);
  }

  if (runs.length === 0) return '        <text></text>';
  return runs.join('\n');
}

function styleElement(node: JSONContent, styleName: string, dual: boolean): string {
  const attrs = node.attrs ?? {};
  let out = `        <style basestylename="${esc(styleName)}"`;

  const align = attrs.textAlign;
  if (typeof align === 'string' && ['left', 'center', 'right', 'justify'].includes(align)) {
    out += ` align="${align}"`;
  }
  if (attrs.startsNewPage === true) out += ' pagebreakbefore="1"';
  if (dual) out += ' dualdialogue="1"';
  return `${out}/>`;
}

function paragraph(node: JSONContent, dual = false): string {
  const type = node.type ?? 'action';
  const styleName = NODE_TO_OSF_STYLE[type] ?? 'Normal Text';

  const attrs = node.attrs ?? {};
  let paraAttrs = '';
  if (type === 'sceneHeading' && typeof attrs.sceneNumber === 'string' && attrs.sceneNumber !== '') {
    paraAttrs += ` scene_number="${esc(attrs.sceneNumber)}"`;
  }
  if (typeof attrs.synopsis === 'string' && attrs.synopsis.trim() !== '') {
    paraAttrs += ` synopsis="${esc(attrs.synopsis.trim())}"`;
  }

  return [
    `      <para${paraAttrs}>`,
    styleElement(node, styleName, dual),
    textRuns(node, type === 'parenthetical'),
    '      </para>',
  ].join('\n');
}

/** Both halves of a dual-dialogue block, flattened back into a run of paragraphs. */
function dualDialogue(node: JSONContent): string[] {
  const out: string[] = [];
  for (const column of node.content ?? []) {
    for (const child of column.content ?? []) {
      out.push(paragraph(child, true));
    }
  }
  return out;
}

function titlePageBlock(node: JSONContent | null): string {
  if (!node) return '';
  const attrs = (node.attrs ?? {}) as Record<string, unknown>;

  const paras: string[] = [];
  for (const [key, bookmark] of TP_ATTR_TO_BOOKMARK) {
    const value = attrs[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    // One <para> per field, with any line breaks kept inside its <text>.
    //
    // Splitting a multi-line field across paragraphs looks tidier and loses
    // information: the reader trims each paragraph, so a continuation line
    // that was indented — "Version 2.0\n\t\tJanuary 13, 2015" in the OSF 2.1
    // specimen — comes back without its indent.
    paras.push(
      [
        `      <para bookmark="${bookmark}">`,
        '        <style basestylename="Normal Text"/>',
        `        <text>${escText(value)}</text>`,
        '      </para>',
      ].join('\n'),
    );
  }
  if (paras.length === 0) return '';
  return ['  <titlepage>', ...paras, '  </titlepage>'].join('\n');
}

/**
 * Serialize a document to Open Screenplay Format XML.
 *
 * This is the `.osf` payload, and the single entry of a `.fadein` archive.
 */
export function exportOSF(doc: JSONContent, options: OSFExportOptions = {}): string {
  const family = options.font?.family?.trim() || 'Courier';
  const size = options.font?.size?.trim() || '12';
  const fontAttrs = ` font="${esc(family)}" size="${esc(size)}"`;

  const styles = BUILTIN_STYLES.map((style) => {
    const base = style.index === 0 ? '' : ' basestylename="Normal Text"';
    return (
      `    <style name="${style.name}" builtin="1" builtin_index="${style.index}"` +
      ` label="${style.name}"${base}${fontAttrs}${style.extra ?? ''}/>`
    );
  });
  // Not a built-in, but OpenDraft has the element and the parser reads the
  // name back, so writing it keeps lyrics from arriving as action.
  styles.push(
    `    <style name="Lyrics" label="Lyrics" basestylename="Normal Text"${fontAttrs} italic="1"/>`,
  );

  let titlePageNode: JSONContent | null = null;
  const body: string[] = [];
  for (const node of doc.content ?? []) {
    if (node.type === 'titlePage') {
      titlePageNode = node;
      continue;
    }
    if (node.type === 'dualDialogue') {
      body.push(...dualDialogue(node));
      continue;
    }
    body.push(paragraph(node));
  }

  // Fade In ends every document with an empty Normal Text paragraph; the
  // parser trims trailing empties on the way in, so this costs nothing and
  // keeps the file shaped like the ones Fade In writes.
  body.push(
    ['      <para>', '        <style name="Normal Text" label="Normal Text"' + fontAttrs + '/>',
      '        <text></text>', '      </para>'].join('\n'),
  );

  const titlePage = titlePageBlock(titlePageNode);

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<document type="Open Screenplay Format document" version="30">',
    // No title attribute here on purpose. OSF 1.2 kept the title-page fields
    // on <info>, and 2.0 moved them into <titlepage>; writing both means a
    // reader that understands both — including this one — sees the title
    // twice, and a file edited over several sessions accumulates a copy per
    // save. The title page is the title page.
    '  <info/>',
    '  <settings page_width="2159" page_height="2794" margin_top="317" margin_bottom="220"' +
      ' margin_left="317" margin_right="317" normal_linesperinch="6.0" element_spacing="1.00"/>',
    '  <styles>',
    ...styles,
    '  </styles>',
    '  <paragraphs>',
    ...body,
    '  </paragraphs>',
    ...(titlePage ? [titlePage] : []),
    '</document>',
    '',
  ].join('\n');
}

/** The single entry a Fade In archive holds. */
const FADEIN_DOCUMENT_ENTRY = 'document.xml';

/**
 * Build a Fade In (.fadein) archive: the OSF XML above, zipped.
 *
 * Deflated rather than stored, which is what Fade In writes, and returned as
 * bytes so the caller can hand them to whichever save path the platform has.
 */
export async function exportFadeIn(
  doc: JSONContent,
  options: OSFExportOptions = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(FADEIN_DOCUMENT_ENTRY, exportOSF(doc, options));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Save the document as a .fadein file, wherever the platform saves files. */
export async function downloadFadeIn(
  doc: JSONContent,
  title = 'Untitled',
  options: OSFExportOptions = {},
): Promise<void> {
  const bytes = await exportFadeIn(doc, options);
  const filename = `${sanitizeExportFilename(title)}.fadein`;
  const { saveFile } = await import('./fileOps');
  await saveFile(bytes, filename, [{ name: 'Fade In', extensions: ['fadein'] }]);
}
