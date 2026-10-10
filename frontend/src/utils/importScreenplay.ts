/**
 * One place that turns an imported file into editor content.
 *
 * The app can start an import from five different places (File ▸ Import, the
 * welcome dialog, an OS file association, a drop onto the editor, and the
 * project view).  Each used to carry its own copy of the extension→parser
 * dispatch, which meant a new format had to be added five times and the copies
 * drifted.  They all call through here instead.
 *
 * Callers still own what happens *after* the parse — setting the document
 * title, clearing project context, marking the source — because those differ
 * between entry points.
 */
import type { JSONContent } from '@tiptap/react';
import { parseFountain } from './fountainParser';
import { DEFAULT_SCRIPT_PROFILE } from './scriptProfile';
import { parseFDXFull } from './fdxParser';
import { parseOSF, parseFadeIn, type DocumentFont } from './osfParser';
import { COURIER_FONTS } from './fonts';
import { parseOdraft } from './odraftFormat';
import { hydrateEditorStoresFromContent } from './hydrateStores';
import { restoreRevisionState } from './revisionState';
import { useEditorStore, DEFAULT_TAG_CATEGORIES } from '../stores/editorStore';

/** Every extension File ▸ Import, drag-and-drop and the OS can hand us. */
export const SCREENPLAY_IMPORT_EXTENSIONS = [
  'fountain',
  'fdx',
  'fadein',
  'osf',
  'odraft',
  'txt',
] as const;

/** File-dialog filter matching {@link SCREENPLAY_IMPORT_EXTENSIONS}. */
export const SCREENPLAY_IMPORT_FILTERS = [
  { name: 'Screenplay', extensions: [...SCREENPLAY_IMPORT_EXTENSIONS] },
];

/**
 * Extensions whose files are archives rather than text, so they have to be
 * read as bytes.  Reading one as UTF-8 corrupts it.
 */
export const BINARY_IMPORT_EXTENSIONS = ['fadein'];

export function extensionOf(filename: string): string {
  const match = /\.([^.\\/]+)$/.exec(filename);
  return match ? match[1].toLowerCase() : '';
}

export function isBinaryImportExtension(ext: string | null | undefined): boolean {
  return !!ext && BINARY_IMPORT_EXTENSIONS.includes(ext.toLowerCase());
}

export function isImportableExtension(ext: string | null | undefined): boolean {
  return !!ext && (SCREENPLAY_IMPORT_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

const FORMAT_LABELS: Record<string, string> = {
  fdx: 'Final Draft (.fdx)',
  fountain: 'Fountain (.fountain)',
  fadein: 'Fade In (.fadein)',
  osf: 'Open Screenplay Format (.osf)',
  odraft: 'OpenDraft (.odraft)',
};

/** Human-readable name for the format an extension denotes. */
export function importFormatLabel(ext: string | null | undefined): string {
  if (!ext) return 'imported file';
  return FORMAT_LABELS[ext.toLowerCase()] || `.${ext.toLowerCase()}`;
}

/** Comma-separated accept string for a bare <input type="file">. */
export const SCREENPLAY_IMPORT_ACCEPT = SCREENPLAY_IMPORT_EXTENSIONS.map((e) => `.${e}`).join(',');

export interface ImportedScreenplay {
  /** ProseMirror document to hand to editor.commands.setContent(). */
  doc: JSONContent;
  /** Title carried by the file itself; empty when the format has none. */
  title: string;
  /** e.g. "Fade In (.fadein)" — for setImportedSource(). */
  formatLabel: string;
  /** Non-fatal notes worth surfacing to the user. */
  warnings: string[];
  /**
   * Script settings the file carries, under the keys a saved script stores
   * them (`_revisionMode`, `_sceneNumbersLocked`…). Already applied to the
   * stores when they were hydrated; a caller saving the import straight into
   * a project merges them into the content it saves.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Clear the per-document collections so an import does not inherit beats,
 * notes, tags or character profiles from the document it replaces.
 */
export function resetStoresForImport(): void {
  const store = useEditorStore.getState();
  store.setBeats([]);
  store.setBeatColumns([]);
  store.setBeatArrangeMode('auto');
  store.setNotes([]);
  store.setGeneralNotes([]);
  store.setTags([]);
  store.setTagCategories([...DEFAULT_TAG_CATEGORIES]);
  store.setCharacterProfiles([]);
  store.setScenes([]);
  store.resetRevisionState();
  // Genre & pacing belong to the script being replaced, not the import.
  store.setScriptProfile(DEFAULT_SCRIPT_PROFILE);
}

/**
 * Scene numbers a production script arrived with.
 *
 * Only production numbering — an A-number such as 12A, or a gap left by a cut
 * scene — changes anything: it is shown and locked, because opening it with
 * numbers hidden would clear them and showing them unlocked would renumber
 * them, and either undoes the numbers a schedule was built on. Plain 1, 2, 3
 * numbering leaves the script's settings as they were, exactly as before:
 * it is what renumbering would produce anyway. Null means "leave them alone".
 */
export function importedSceneNumbering(doc: { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> }): { visible: boolean; locked: boolean } | null {
  const numbered = (doc.content ?? [])
    .filter((n) => n.type === 'sceneHeading')
    .map((n) => (n.attrs?.sceneNumber == null ? '' : String(n.attrs.sceneNumber).trim()))
    .filter(Boolean);
  if (numbered.length === 0) return null;
  const production = numbered.some((n) => !/^\d+$/.test(n))
    || numbered.some((n, i) => Number(n) !== i + 1);
  return production ? { visible: true, locked: true } : null;
}

/**
 * The script settings an .fdx carries, as the keys a saved script stores them
 * under (see utils/saveContent): its revisions — the mode, the active colour,
 * every colour used and the marks — and its scene numbering.
 */
export function fdxMetadata(parsed: ReturnType<typeof parseFDXFull>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const r = parsed.revisions;
  if (r) {
    meta._revisionMode = r.mode;
    meta._revisionColor = r.color ?? r.colors[r.colors.length - 1] ?? undefined;
    meta._revisionHistory = r.colors.map((color) => ({ color, date: '' }));
    meta._revisionSettings = r.settings;
  }
  const numbering = importedSceneNumbering(parsed.doc as { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> });
  if (numbering) {
    meta._sceneNumbersVisible = numbering.visible;
    meta._sceneNumbersLocked = numbering.locked;
  }
  // Any app setting in a saved payload marks it as written by OpenDraft, and
  // one with no spacing key is then taken for a script from before the
  // two-line scene-heading standard (utils/elementSpacing). An import is new,
  // so it says so: null follows the template, exactly as a bare import did.
  if (Object.keys(meta).length > 0) meta._sceneHeadingSpaceBefore = null;
  return meta;
}

/** Apply the page layout, beats and cast an .fdx carries alongside its text. */
function applyFdxSideEffects(parsed: ReturnType<typeof parseFDXFull>): void {
  const store = useEditorStore.getState();

  // Revisions and scene numbering: what fdxMetadata() reads, put into the
  // store exactly as reopening a saved script would.
  const meta = fdxMetadata(parsed);
  if (meta._revisionHistory) restoreRevisionState(meta);
  if (typeof meta._sceneNumbersVisible === 'boolean') store.setSceneNumbersVisible(meta._sceneNumbersVisible);
  if (typeof meta._sceneNumbersLocked === 'boolean') store.setSceneNumbersLocked(meta._sceneNumbersLocked);

  if (parsed.pageLayout) {
    store.setPageLayout({ ...store.pageLayout, ...parsed.pageLayout });
  }

  if (parsed.beats.length > 0) {
    store.setBeats(parsed.beats);
    if (parsed.beatColumns.length > 0) store.setBeatColumns(parsed.beatColumns);
  }

  if (parsed.castList.length > 0 || parsed.characterHighlighting.length > 0) {
    const highlightMap = new Map(parsed.characterHighlighting.map((h) => [h.name.toUpperCase(), h]));
    for (const member of parsed.castList) {
      const hl = highlightMap.get(member.name.toUpperCase());
      store.upsertCharacterProfile(member.name, {
        description: member.description,
        color: hl?.color || '',
        highlighted: hl?.highlighted || false,
      });
      highlightMap.delete(member.name.toUpperCase());
    }
    // Highlights for characters with no cast-list entry of their own.
    for (const [, hl] of highlightMap) {
      store.upsertCharacterProfile(hl.name, { color: hl.color, highlighted: hl.highlighted });
    }
  }
}

/**
 * Put the file's own typeface on the page.
 *
 * A Fade In stage play set in Times New Roman, a BBC radio script in Arial, or
 * a Final Draft script in anything but Courier all carry the typeface on their
 * element settings rather than their text, so without this the script imports
 * in whatever the editor already had — Courier Prime — and the format the
 * writer chose is lost.
 *
 * Courier variants are left alone deliberately: Courier Prime is OpenDraft's
 * own screenplay face and is metric-compatible with the Couriers files name,
 * so switching to a worse one would be a downgrade, not fidelity.
 */
function applyDocumentFont(font: DocumentFont): void {
  const store = useEditorStore.getState();
  if (font.family && !COURIER_FONTS.includes(font.family)) store.setFontFamily(font.family);

  const size = parseInt(font.size, 10);
  if (Number.isFinite(size) && size > 0 && size !== store.fontSize) store.setFontSize(size);
}

export interface ParseScreenplayOptions {
  /**
   * Whether to push the file's beats, cast, page layout, notes and tags into
   * the editor stores.  True when the import replaces the open document;
   * false when it only creates a script in a project, where clobbering the
   * open document's state would be wrong.
   */
  hydrateStores?: boolean;
}

/**
 * Parse an imported screenplay and, unless told otherwise, restore whatever
 * editor state the format carries.  `data` must be an ArrayBuffer for archive
 * formats (see {@link isBinaryImportExtension}) and a string otherwise.
 *
 * Throws with a user-facing message when the file cannot be read.
 */
export async function parseScreenplayImport(
  filename: string,
  data: string | ArrayBuffer,
  options: ParseScreenplayOptions = {},
): Promise<ImportedScreenplay> {
  const { hydrateStores = true } = options;
  const ext = extensionOf(filename);
  const formatLabel = importFormatLabel(ext);

  if (isBinaryImportExtension(ext) && typeof data === 'string') {
    throw new Error(
      `${formatLabel} files are compressed archives and cannot be opened on this platform. ` +
        'Export the script from Fade In as .fdx, .fountain or .osf and import that instead.',
    );
  }
  if (!isBinaryImportExtension(ext) && typeof data !== 'string') {
    throw new Error(`Expected text content for a ${formatLabel} file.`);
  }

  if (hydrateStores) resetStoresForImport();

  if (ext === 'fadein') {
    const parsed = await parseFadeIn(data as ArrayBuffer);
    if (hydrateStores) applyDocumentFont(parsed.documentFont);
    return { doc: parsed.doc, title: parsed.scriptTitle, formatLabel, warnings: parsed.warnings };
  }

  const text = data as string;

  if (ext === 'osf') {
    const parsed = parseOSF(text);
    if (hydrateStores) applyDocumentFont(parsed.documentFont);
    return { doc: parsed.doc, title: parsed.scriptTitle, formatLabel, warnings: parsed.warnings };
  }

  if (ext === 'fdx') {
    const parsed = parseFDXFull(text);
    if (hydrateStores) {
      applyFdxSideEffects(parsed);
      applyDocumentFont(parsed.documentFont);
    }
    return { doc: parsed.doc, title: '', formatLabel, warnings: [], metadata: fdxMetadata(parsed) };
  }

  if (ext === 'odraft') {
    let parsed;
    try {
      parsed = parseOdraft(text);
    } catch (err) {
      throw new Error(`Invalid .odraft file: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Bring back notes, tags, beats and character profiles — without this an
    // imported .odraft comes back as bare text with all of that dropped.
    if (hydrateStores) hydrateEditorStoresFromContent(parsed.content);
    // Images travel in the envelope's `assets` array. They were ignored here
    // entirely, so even a backup that had carefully packed them came back with
    // every picture broken. Restoring them under their original ids is what
    // makes the document's own references resolve again.
    if (parsed.assets?.length) {
      try {
        const { unpackScratchAssets } = await import('../services/snapshotAssets');
        await unpackScratchAssets(parsed.assets);
      } catch (err) {
        console.warn('[import] could not restore images from the .odraft file:', err);
      }
    }
    return {
      doc: parsed.content,
      title: parsed.meta.title || '',
      formatLabel,
      warnings: [],
    };
  }

  // .fountain, .txt, and anything else we were handed as plain text.
  return { doc: parseFountain(text), title: '', formatLabel, warnings: [] };
}
