/**
 * OpenDraft AV YAML — a structured, human-readable interchange format.
 *
 * The other formats each give up something. A spreadsheet flattens cells to
 * plain strings and loses the paragraph structure and the document's layout
 * settings. `.odraft` keeps everything but is opaque. This sits between them:
 * plain text you can read, diff and edit in any editor, that still preserves
 * the distinction between rows, columns, blank cells, cue metadata and
 * document-level settings.
 *
 * Deliberately NOT included: the storyboard images themselves. Embedding them
 * would mean base64 blobs or external file dependencies, and either turns a
 * readable text file into something that is neither readable nor reliable. The
 * frames' *descriptions* and aspect ratios are preserved, so the column, its
 * shape and what belongs in each slot survive a round trip — only the pixels
 * have to be re-attached.
 *
 * Every file identifies itself and carries a schema version. Reading a file
 * from a newer OpenDraft, or a YAML file that is not an AV document at all,
 * reports that plainly rather than guessing and silently producing a damaged
 * document.
 */
import { load as yamlLoad, dump as yamlDump, YAMLException } from 'js-yaml';
import type { JSONContent } from '@tiptap/react';
import { jsonBlockText } from './nodeText';
import { extractAvBodies, AV_DEFAULT_HEADERS } from './avDocument';
import { readColumnConfig, clampColumnWidth } from '../editor/extensions/AvBlock';
import { parseTimecode, formatTimecode } from '../editor/avTiming';

/** Identifies a file as ours. */
export const AV_YAML_FORMAT = 'opendraft-av';

/**
 * The schema version this build writes and the highest it can read.
 *
 * Bump when the shape changes. A file whose version is higher is refused with
 * a message naming both versions — the alternative is reading a structure we
 * do not understand and quietly dropping whatever is new in it.
 */
export const AV_YAML_SCHEMA_VERSION = 1;

/** Raised for anything wrong with the file, with a message meant for a user. */
export class AvYamlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvYamlError';
  }
}

// ── Writing ────────────────────────────────────────────────────────────────

/** One paragraph of an AV cell, with its style. */
interface YamlPara { style: string; text: string }

/**
 * Paragraph style names as they appear in the file — readable, not internal.
 *
 * The first four are the AV paragraph types and their names are FIXED: files
 * written before the rest existed use them, and renaming one would silently
 * downgrade every paragraph in an older file to plain body text.
 *
 * The rest are the screenplay elements a cell holds when the active template
 * allows it. Without them a round-trip through YAML flattened an interview to
 * narration — `yamlToCell` falls back to `body` for a style it does not know,
 * which is right for a hand-written file and wrong as a way to lose an
 * element OpenDraft wrote itself.
 *
 * `customElement` has no entry: its identity is an attribute, not a type, and
 * there is nothing here to carry a `customTypeId`. It writes as `body`, which
 * is what it reads as, and is noted rather than silently assumed.
 */
const STYLE_TO_YAML: Record<string, string> = {
  avPara: 'body',
  avShot: 'shot',
  avDirection: 'direction',
  avGraphic: 'onscreen',
  action: 'action',
  sceneHeading: 'scene-heading',
  character: 'character',
  dialogue: 'dialogue',
  parenthetical: 'parenthetical',
  transition: 'transition',
  // `shot` is already taken by avShot, which has meant "the video column's shot
  // line" since the format was written. The screenplay element of the same name
  // is a camera instruction, so it says so.
  shot: 'camera-shot',
  general: 'general',
  lyrics: 'lyrics',
};
const YAML_TO_STYLE: Record<string, string> = Object.fromEntries(
  Object.entries(STYLE_TO_YAML).map(([k, v]) => [v, k]),
);

/** Read one AV cell's paragraphs, keeping each one's style. */
function cellToYaml(cell: JSONContent | null | undefined): YamlPara[] {
  if (!cell || !Array.isArray(cell.content)) return [];
  const out: YamlPara[] = [];
  for (const para of cell.content) {
    out.push({ style: STYLE_TO_YAML[para.type || 'avPara'] || 'body', text: jsonBlockText(para) });
  }
  // Trailing blank paragraphs are padding, not content.
  while (out.length && out[out.length - 1].text.trim() === '') out.pop();
  return out;
}

/** The cells of one row, matched by side. */
function rowCells(row: JSONContent) {
  const cells = Array.isArray(row.content) ? row.content : [];
  return {
    video: cells.find(c => c?.type === 'avCell' && (c.attrs as { side?: string })?.side !== 'audio') || null,
    audio: cells.find(c => c?.type === 'avCell' && (c.attrs as { side?: string })?.side === 'audio') || null,
    image: cells.find(c => c?.type === 'avImage') || null,
  };
}

/** Document-level settings an AV YAML file carries. */
export interface AvYamlDocumentMeta {
  title?: string;
  subtitle?: string;
  author?: string;
  draft?: string;
  date?: string;
  font?: { family?: string; size?: number };
  page?: {
    orientation?: 'portrait' | 'landscape';
    width?: number;
    height?: number;
    margins?: { top?: number; bottom?: number; left?: number; right?: number };
  };
}

/** Drop undefined/empty members so the file stays readable. */
function prune<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const inner = prune(v as Record<string, unknown>);
      if (Object.keys(inner).length) out[k] = inner;
      continue;
    }
    out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * Serialise a document's AV bodies as OpenDraft AV YAML.
 *
 * Returns null when the document holds no AV content, so a caller can decline
 * to offer the format rather than writing a file with nothing in it.
 */
export function avDocumentToYaml(
  doc: JSONContent | null | undefined,
  meta?: AvYamlDocumentMeta,
): string | null {
  const bodies = extractAvBodies(doc);
  if (!bodies.length) return null;

  // Row nodes, so paragraph styles survive — extractAvBodies flattens to text.
  const blocks: JSONContent[] = [];
  const walk = (n: JSONContent | null | undefined) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'avBlock') { blocks.push(n); return; }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);

  const sections = bodies.map((body, i) => {
    const block = blocks[i];
    const rowNodes = Array.isArray(block?.content) ? block!.content.filter(n => n?.type === 'avRow') : [];

    // Width travels with the column it belongs to rather than in a separate
    // map, so a hand-edited file cannot get the two out of step.
    const widths = readColumnConfig(block?.attrs).widths;
    const columns: Record<string, unknown>[] = [];
    if (body.columns.cue) columns.push({ id: 'cue', name: body.headers.cue, width: widths.cue });
    columns.push({ id: 'video', name: body.headers.video, width: widths.video });
    columns.push({ id: 'audio', name: body.headers.audio, width: widths.audio });
    if (body.columns.image) columns.push({ id: 'storyboard', name: body.headers.image, width: widths.image });

    const rows = rowNodes.map((row, ri) => {
      const cells = rowCells(row);
      const resolved = body.rows[ri];
      const attrs = (row.attrs || {}) as { shot?: string | null; start?: string | null; duration?: string | null };
      const entry: Record<string, unknown> = {};

      if (body.columns.cue) {
        // Only what the writer actually set is stored; shot number and start
        // are derived from row order and the durations above, so writing them
        // back would freeze values that are supposed to recompute.
        const cue = prune({
          shot: attrs.shot ?? undefined,
          start: attrs.start ?? undefined,
          duration: attrs.duration ?? undefined,
        });
        if (Object.keys(cue).length) entry.cue = cue;
        // Rendered values, for a human reading the file. Ignored on import.
        entry.at = resolved?.start || '0:00';
      }

      const video = cellToYaml(cells.video);
      const audio = cellToYaml(cells.audio);
      if (video.length) entry.video = video;
      if (audio.length) entry.audio = audio;

      if (cells.image) {
        const ia = (cells.image.attrs || {}) as { alt?: string | null; aspect?: string; assetId?: string | null };
        entry.storyboard = prune({
          description: ia.alt ?? undefined,
          aspect: ia.aspect || '16:9',
          // Named, not embedded: the pixels stay out of the text file.
          asset: ia.assetId ?? undefined,
        });
      }

      return entry;
    });

    return prune({
      columns,
      repeatColumnHeaders: (block?.attrs as { repeatHeaders?: boolean } | undefined)?.repeatHeaders !== false,
      totalRuntime: body.totalSeconds > 0 ? body.totalFormatted : undefined,
      rows,
    });
  });

  const file = {
    format: AV_YAML_FORMAT,
    schemaVersion: AV_YAML_SCHEMA_VERSION,
    ...(meta && Object.keys(prune(meta as Record<string, unknown>)).length
      ? { document: prune(meta as Record<string, unknown>) }
      : {}),
    // One body is by far the common case; a list keeps multi-body documents
    // representable without a second schema.
    av: sections,
  };

  return yamlDump(file, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
    // Keys in the order built above rather than alphabetical, so the file reads
    // top-down the way the document does.
    sortKeys: false,
  });
}

// ── Reading ────────────────────────────────────────────────────────────────

/** What an import produced. */
export interface AvYamlImportResult {
  /** The `avBlock` nodes, in file order. */
  blocks: JSONContent[];
  /** Document-level settings, when the file carried any. */
  document: AvYamlDocumentMeta | null;
  /** Total rows across all bodies. */
  rowCount: number;
}

/** Turn YAML paragraphs back into AV cell content. */
function yamlToCell(side: 'video' | 'audio', paras: unknown): JSONContent {
  const list = Array.isArray(paras) ? paras : [];
  const content = list.map((p) => {
    // A bare string is allowed: `video: [WIDE ON STREET]` is valid and obvious,
    // and a human editing the file by hand will write that.
    if (typeof p === 'string') {
      return p ? { type: 'avPara', content: [{ type: 'text', text: p }] } : { type: 'avPara' };
    }
    const obj = (p || {}) as Record<string, unknown>;

    if (typeof obj.text === 'string' || typeof obj.style === 'string') {
      const type = YAML_TO_STYLE[String(obj.style || 'body')] || 'avPara';
      const text = typeof obj.text === 'string' ? obj.text : '';
      return text ? { type, content: [{ type: 'text', text }] } : { type };
    }

    // An unquoted line containing a colon. YAML reads `- NARRATOR: Hello` as the
    // map {NARRATOR: "Hello"}, and nearly every line of AV audio has a colon in
    // it ("NARRATOR:", "SFX:", "MUSIC:"), so this is THE mistake a hand-edited
    // file makes. Undoing YAML's own parse is not guesswork — the original text
    // is recoverable exactly — and the alternative is silently dropping the
    // writer's line.
    const entries = Object.entries(obj);
    if (entries.length === 1) {
      const [key, value] = entries[0];
      const tail = value === null || value === undefined ? '' : String(value);
      const text = tail ? `${key}: ${tail}` : `${key}:`;
      return { type: 'avPara', content: [{ type: 'text', text }] };
    }

    return { type: 'avPara' };
  });
  return { type: 'avCell', attrs: { side }, content: content.length ? content : [{ type: 'avPara' }] };
}

/**
 * Parse OpenDraft AV YAML.
 *
 * Throws `AvYamlError` with a message meant to be shown to the user: a file
 * that is not ours, a schema version we cannot read, or structurally invalid
 * content. Guessing at any of those risks producing a document that looks
 * plausible and is wrong.
 */
export function importAvYaml(text: string): AvYamlImportResult {
  let parsed: unknown;
  try {
    parsed = yamlLoad(text);
  } catch (err) {
    const where = err instanceof YAMLException && err.mark ? ` (line ${err.mark.line + 1})` : '';
    throw new AvYamlError(`That file is not valid YAML${where}.`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AvYamlError('That file is not an OpenDraft AV document.');
  }
  const file = parsed as Record<string, unknown>;

  if (file.format !== AV_YAML_FORMAT) {
    throw new AvYamlError(
      `That file is not an OpenDraft AV document (expected format: ${AV_YAML_FORMAT}).`,
    );
  }

  const version = Number(file.schemaVersion);
  if (!Number.isFinite(version) || version < 1) {
    throw new AvYamlError('That file does not say which AV schema version it uses.');
  }
  if (version > AV_YAML_SCHEMA_VERSION) {
    throw new AvYamlError(
      `That file uses AV schema version ${version}, but this version of OpenDraft reads up to ${AV_YAML_SCHEMA_VERSION}. Update OpenDraft to open it.`,
    );
  }

  const sections = Array.isArray(file.av) ? file.av : null;
  if (!sections || !sections.length) {
    throw new AvYamlError('That AV file has no `av:` section to import.');
  }

  const blocks: JSONContent[] = [];
  let rowCount = 0;

  sections.forEach((raw, si) => {
    const section = (raw || {}) as Record<string, unknown>;
    const columns = Array.isArray(section.columns) ? section.columns : [];
    const ids = new Set(
      columns.map(c => String((c as { id?: string })?.id || '')).filter(Boolean),
    );
    const colDef = (id: string) =>
      columns.find(c => (c as { id?: string })?.id === id) as { name?: string; width?: unknown } | undefined;
    const nameFor = (id: string, fallback: string) => {
      const name = colDef(id)?.name;
      return typeof name === 'string' && name.trim() ? name.trim() : fallback;
    };
    // clampColumnWidth rejects a zero or non-numeric width from a hand-edited
    // file, which would otherwise make a column impossible to click into.
    const widthFor = (id: string, fallback: number) => {
      const raw = colDef(id)?.width;
      return raw === undefined || raw === null ? fallback : clampColumnWidth(raw);
    };

    const rawRows = Array.isArray(section.rows) ? section.rows : [];
    if (!rawRows.length) {
      throw new AvYamlError(`AV section ${si + 1} has no rows.`);
    }

    const content = rawRows.map((rr) => {
      const r = (rr || {}) as Record<string, unknown>;
      const cue = (r.cue || {}) as { shot?: unknown; start?: unknown; duration?: unknown };
      const durationRaw = cue.duration === undefined || cue.duration === null ? '' : String(cue.duration);
      const durSecs = parseTimecode(durationRaw);
      const startRaw = cue.start === undefined || cue.start === null ? '' : String(cue.start);

      const storyboard = (r.storyboard || null) as
        | { description?: string; aspect?: string; asset?: string }
        | null;

      return {
        type: 'avRow',
        attrs: {
          shot: cue.shot !== undefined && cue.shot !== null && String(cue.shot).trim() !== ''
            ? String(cue.shot).trim() : null,
          start: parseTimecode(startRaw) !== null ? startRaw : null,
          // Normalise so "5" from a hand-edited file becomes "0:05".
          duration: durSecs !== null ? formatTimecode(durSecs) : (durationRaw || null),
        },
        content: [
          yamlToCell('video', r.video),
          yamlToCell('audio', r.audio),
          ...(storyboard
            ? [{
                type: 'avImage',
                attrs: {
                  src: null,
                  // The pixels are not in the file; the description and shape are.
                  alt: storyboard.description ?? null,
                  assetId: storyboard.asset ?? null,
                  aspect: storyboard.aspect || '16:9',
                },
              }]
            : []),
        ],
      } as JSONContent;
    });

    rowCount += content.length;

    blocks.push({
      type: 'avBlock',
      attrs: {
        columns: {
          cue: ids.size ? ids.has('cue') : true,
          image: ids.has('storyboard') || content.some(row =>
            Array.isArray(row.content) && row.content.some(c => c?.type === 'avImage')),
          widths: {
            cue: widthFor('cue', 0.5),
            video: widthFor('video', 2),
            audio: widthFor('audio', 2),
            image: widthFor('storyboard', 1.5),
          },
        },
        headers: {
          cue: nameFor('cue', AV_DEFAULT_HEADERS.cue),
          video: nameFor('video', AV_DEFAULT_HEADERS.video),
          audio: nameFor('audio', AV_DEFAULT_HEADERS.audio),
          image: nameFor('storyboard', AV_DEFAULT_HEADERS.image),
        },
        repeatHeaders: section.repeatColumnHeaders !== false,
      },
      content,
    });
  });

  const document = (file.document && typeof file.document === 'object')
    ? (file.document as AvYamlDocumentMeta)
    : null;

  return { blocks, document, rowCount };
}

// ── Save helper ────────────────────────────────────────────────────────────

/** Save the document's AV bodies as OpenDraft AV YAML. */
export async function downloadAvYaml(
  doc: JSONContent | null | undefined,
  title = 'Untitled',
  meta?: AvYamlDocumentMeta,
): Promise<void> {
  const text = avDocumentToYaml(doc, { title, ...meta });
  if (!text) throw new Error('This document has no AV content to export.');
  const { sanitizeExportFilename } = await import('./exportFilename');
  const { saveFile } = await import('./fileOps');
  await saveFile(text, `${sanitizeExportFilename(title)}.yaml`, [
    { name: 'OpenDraft AV YAML', extensions: ['yaml', 'yml'] },
  ]);
}
