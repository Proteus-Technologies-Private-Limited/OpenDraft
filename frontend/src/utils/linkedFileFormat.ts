/**
 * Turning a saved script into the text of a file on disk, and back.
 *
 * Shared by everything that writes a script into a file the writer keeps: Save
 * on a document opened from disk, and scripts linked to files or to a project
 * folder (issue #135). Both work from the saved payload — the editor JSON with
 * the `_`-prefixed app state beside it (utils/saveContent) — so a script that
 * is not open in the editor can be written exactly as one that is.
 *
 * Only text formats are linkable. A linked file is rewritten on every save,
 * and text goes through `save_text_atomic`, so a write cut short by a dropped
 * network drive leaves the old file intact rather than half of a new one. Fade
 * In's .fadein is a zip archive, written in one non-atomic pass, so it is left
 * to Open File from Disk, where every save is one the writer asked for.
 */
import type { JSONContent } from '@tiptap/core';
import type { ScriptMeta } from '../services/api';
import { exportFDX } from './fdxExporter';
import { exportFountain } from './fountainExporter';
import { exportOSF } from './osfExporter';
import { serializeOdraft } from './odraftFormat';
import { stripSaveMetadata } from './saveContent';
import { readRevisionState } from './revisionState';
import { sanitizeForFilename } from './backupNaming';
import { looksLikeTreatment } from './scriptFormat';
import type {
  BeatColumn, BeatInfo, CharacterProfile, PageLayout, TagCategory, TagItem,
} from '../stores/editorStore';

/** Formats a project folder can be set to write new scripts in. */
export const LINKED_FILE_FORMATS = ['odraft', 'fountain', 'fdx'] as const;

/** Every format a linked file can be in: the above, plus .osf found in a folder. */
export type LinkedFileFormat = 'odraft' | 'fountain' | 'fdx' | 'osf';

const LINKABLE = new Set<string>(['odraft', 'fountain', 'fdx', 'osf']);

export const LINKED_FORMAT_LABELS: Record<LinkedFileFormat, string> = {
  odraft: 'OpenDraft (.odraft) — keeps everything',
  fountain: 'Fountain (.fountain)',
  fdx: 'Final Draft (.fdx)',
  osf: 'Open Screenplay Format (.osf)',
};

export const DEFAULT_LINKED_FORMAT: LinkedFileFormat = 'odraft';

/** Lower-case extension of a file name or path, without the dot; '' if none. */
export function extensionOfPath(path: string): string {
  const name = path.split(/[/\\]/).pop() || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isLinkableExtension(ext: string): ext is LinkedFileFormat {
  return LINKABLE.has(ext.toLowerCase());
}

/** A stored or chosen format, or the default when it is not one we can write. */
export function normalizeLinkedFormat(raw: unknown): LinkedFileFormat {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/^\./, '') : '';
  return isLinkableExtension(v) ? v : DEFAULT_LINKED_FORMAT;
}

/** True when a saved payload contains an AV script body anywhere in it. */
export function contentHasAv(content: unknown): boolean {
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;
    const n = node as { type?: unknown; content?: unknown };
    if (n.type === 'avBlock') return true;
    return Array.isArray(n.content) && n.content.some(walk);
  };
  return walk(content);
}

/**
 * The format a script is actually written in, given the one its project asks
 * for. A treatment is prose and an AV script is a table; neither has anywhere
 * to go in a screenplay interchange format, so both are kept as .odraft.
 */
export function formatForScript(
  preferred: LinkedFileFormat,
  scriptFormat: string | null | undefined,
  content: unknown,
): LinkedFileFormat {
  if (preferred === 'odraft') return 'odraft';
  if (scriptFormat === 'treatment' || looksLikeTreatment(content) || contentHasAv(content)) return 'odraft';
  return preferred;
}

/** Name of the folder a new project gets inside the projects folder. */
export function projectFolderName(projectName: string): string {
  return sanitizeForFilename(projectName);
}

/** File name a script is saved under in a linked folder: its title, made safe. */
export function linkedFileName(title: string, format: LinkedFileFormat): string {
  return `${sanitizeForFilename(title)}.${format}`;
}

/**
 * `Pilot.fountain`, then `Pilot 2.fountain`, `Pilot 3.fountain`… — the first
 * name `taken` says is free. Compared case-insensitively, because two names
 * differing only in case are the same file on macOS and Windows.
 */
export function uniqueFileName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem} ${n}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  return `${stem} ${Date.now()}${ext}`;
}

export interface SerializeOptions {
  /** The editor's typeface, which the payload does not carry. */
  font?: { family: string; size: number };
  /** Script metadata for the .odraft envelope. */
  meta?: Partial<ScriptMeta>;
}

/**
 * The text of a linked file, from a saved payload.
 *
 * Throws for a format it cannot write; callers treat that as a failed save.
 */
export function serializeContentForFormat(
  format: string,
  content: Record<string, unknown>,
  title: string,
  options: SerializeOptions = {},
): string {
  const { pmDoc, metadata: m } = stripSaveMetadata(content);
  const doc = pmDoc as JSONContent;
  const revision = readRevisionState(content);
  const sceneNumbersVisible = m._sceneNumbersVisible !== false;
  const font = options.font ?? { family: 'Courier Prime', size: 12 };

  switch (format) {
    case 'fdx':
      return exportFDX(
        doc, title,
        asArray<CharacterProfile>(m._characterProfiles),
        asArray<TagCategory>(m._tagCategories),
        asArray<TagItem>(m._tags),
        asArray<BeatInfo>(m._beats),
        asArray<BeatColumn>(m._beatColumns),
        (m._pageLayout && typeof m._pageLayout === 'object' ? m._pageLayout : undefined) as PageLayout | undefined,
        { family: font.family, size: font.size },
        undefined,
        { mode: revision.revisionMode, color: revision.revisionColor, settings: revision.revisionSettings },
        { sceneNumbersVisible },
      );
    case 'fountain':
    case 'txt':
      return exportFountain(doc, { revisionSettings: revision.revisionSettings, sceneNumbersVisible });
    case 'osf':
      return exportOSF(doc, {
        font: { family: font.family, size: String(font.size) },
        revisions: { color: revision.revisionMode ? revision.revisionColor : '', settings: revision.revisionSettings },
        sceneNumbers: { visible: sceneNumbersVisible, locked: m._sceneNumbersLocked === true },
      });
    case 'odraft':
      // The native format, and the only one that carries everything — notes,
      // tags, beats and profiles — so it holds the whole payload.
      return serializeOdraft(
        {
          id: '', author: '', format: 'json', created_at: '', updated_at: '',
          page_count: 0, size_bytes: 0, color: '', pinned: false, sort_order: 0, preview: '',
          ...options.meta,
          title,
        },
        content,
      );
    default:
      throw new Error(`OpenDraft cannot write .${format} files.`);
  }
}

function asArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? (value as T[]) : undefined;
}

export interface ParsedLinkedFile {
  /** The saved payload to store in the library. */
  content: Record<string, unknown>;
  /** Title carried by the file itself; '' when the format has none. */
  title: string;
  /** Library format of the script: 'treatment' for treatment prose, else 'screenplay'. */
  scriptFormat: 'screenplay' | 'treatment';
}

/**
 * A linked file's text as a saved payload, without touching the open editor.
 *
 * Throws with a user-facing message when the file cannot be read as the format
 * its extension claims.
 */
export async function parseLinkedFileText(name: string, text: string): Promise<ParsedLinkedFile> {
  const { parseScreenplayImport } = await import('./importScreenplay');
  const imported = await parseScreenplayImport(name, text, { hydrateStores: false });
  const content = {
    ...(imported.doc as Record<string, unknown>),
    ...(imported.metadata ?? {}),
  };
  return {
    content,
    title: imported.title || '',
    scriptFormat: looksLikeTreatment(content) ? 'treatment' : 'screenplay',
  };
}
