/**
 * OpenDraft native format (.odraft) — import/export utilities.
 *
 * An .odraft file is a JSON document containing the script metadata and
 * TipTap content, designed for lossless round-tripping. It is also the format
 * automatic backups are written in, which is why fidelity matters here: a
 * snapshot that can't be fully restored is not a backup.
 *
 * ## Versions
 *
 * - **v1** — `content` was whatever the caller passed. In practice File →
 *   Export passed the bare editor JSON, so notes, tags, beats and character
 *   profiles were silently dropped. Still readable.
 * - **v2** — `content` is the full `buildSaveContent()` payload (document plus
 *   every `_`-prefixed store key), `meta` carries provenance, and `assets` may
 *   embed the images the document references. Images live outside the document
 *   as `assetId` references into `$APPDATA/assets/`, so without embedding them
 *   a restored script comes back with every image broken.
 */

import type { ScriptMeta } from '../services/api';

export const ODRAFT_VERSION = 2;

export type BackupKind = 'auto' | 'manual' | 'crash';

export interface OdraftAsset {
  id: string;
  filename: string;
  mime_type: string;
  /** Base64-encoded bytes (no data: prefix). */
  data_base64: string;
}

export interface OdraftMeta {
  title: string;
  author: string;
  color: string;
  page_count: number;
  /** Provenance — lets a restore offer "put it back where it came from". */
  project_id?: string | null;
  script_id?: string | null;
  project_title?: string;
  app_version?: string;
  backup_kind?: BackupKind;
  /** True when images were deliberately left out (disabled, or over the cap). */
  assets_omitted?: boolean;
}

interface OdraftFile {
  odraft_version: number;
  format: 'opendraft-script';
  exported_at: string;
  meta: OdraftMeta;
  content: Record<string, unknown>;
  assets?: OdraftAsset[];
}

export interface ParsedOdraft {
  meta: OdraftMeta;
  content: Record<string, unknown>;
  assets: OdraftAsset[];
  /** Version the file declared; 0 for a bare payload recovered by parseOdraftLoose. */
  version: number;
}

export interface ExportOdraftOptions {
  assets?: OdraftAsset[];
  backupKind?: BackupKind;
  projectId?: string | null;
  scriptId?: string | null;
  projectTitle?: string;
  appVersion?: string;
  assetsOmitted?: boolean;
  /** Injectable for tests; defaults to now. */
  exportedAt?: string;
}

/** Build an .odraft JSON blob from script metadata and content. */
export function exportOdraft(
  meta: ScriptMeta,
  content: Record<string, unknown>,
  options: ExportOdraftOptions = {},
): Blob {
  return new Blob([serializeOdraft(meta, content, options)], {
    type: 'application/json',
  });
}

/** The .odraft JSON text. Separated from the Blob so callers that write to a
 *  file (backups) don't have to round-trip through Blob.text(). */
export function serializeOdraft(
  meta: ScriptMeta,
  content: Record<string, unknown>,
  options: ExportOdraftOptions = {},
): string {
  const data: OdraftFile = {
    odraft_version: ODRAFT_VERSION,
    format: 'opendraft-script',
    exported_at: options.exportedAt || new Date().toISOString(),
    meta: {
      title: meta.title,
      author: meta.author,
      color: meta.color,
      page_count: meta.page_count,
      ...(options.projectId !== undefined ? { project_id: options.projectId } : {}),
      ...(options.scriptId !== undefined ? { script_id: options.scriptId } : {}),
      ...(options.projectTitle ? { project_title: options.projectTitle } : {}),
      ...(options.appVersion ? { app_version: options.appVersion } : {}),
      ...(options.backupKind ? { backup_kind: options.backupKind } : {}),
      ...(options.assetsOmitted ? { assets_omitted: true } : {}),
    },
    content,
    ...(options.assets && options.assets.length > 0 ? { assets: options.assets } : {}),
  };
  return JSON.stringify(data, null, 2);
}

/** Download a script as an .odraft file. */
export async function downloadOdraft(
  meta: ScriptMeta,
  content: Record<string, unknown>,
  options: ExportOdraftOptions = {},
): Promise<void> {
  const text = serializeOdraft(meta, content, options);
  const filename = `${meta.title || 'Untitled'}.odraft`;
  const { saveFile } = await import('./fileOps');
  await saveFile(text, filename, [{ name: 'OpenDraft', extensions: ['odraft'] }]);
}

/** Parse an .odraft JSON string back into meta + content. */
export function parseOdraft(jsonText: string): ParsedOdraft {
  let data: any;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Invalid .odraft file: not valid JSON');
  }

  if (data.format !== 'opendraft-script') {
    throw new Error('Invalid .odraft file: unrecognized format');
  }
  if (typeof data.odraft_version !== 'number') {
    throw new Error('Invalid .odraft file: missing version');
  }
  if (data.odraft_version > ODRAFT_VERSION) {
    throw new Error(
      `This .odraft file was created by a newer version of OpenDraft (format v${data.odraft_version}). Update OpenDraft to open it.`,
    );
  }

  return {
    version: data.odraft_version,
    meta: {
      title: data.meta?.title || 'Untitled',
      author: data.meta?.author || '',
      color: data.meta?.color || '',
      page_count: data.meta?.page_count || 0,
      project_id: data.meta?.project_id ?? null,
      script_id: data.meta?.script_id ?? null,
      project_title: data.meta?.project_title,
      app_version: data.meta?.app_version,
      backup_kind: data.meta?.backup_kind,
      assets_omitted: data.meta?.assets_omitted === true,
    },
    content: data.content || {},
    assets: Array.isArray(data.assets) ? data.assets : [],
  };
}

/**
 * Parse an .odraft file, falling back to accepting a bare payload.
 *
 * Older builds wrote crash backups as the raw `buildSaveContent()` object with
 * no envelope, which `parseOdraft` rejects — meaning OpenDraft could not open
 * its own emergency backup. Any such file already on a user's disk is
 * recoverable here: if the JSON has no envelope but looks like a ProseMirror
 * document, treat the whole object as the content.
 */
export function parseOdraftLoose(jsonText: string): ParsedOdraft {
  let data: any;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Invalid .odraft file: not valid JSON');
  }

  if (data?.format === 'opendraft-script') return parseOdraft(jsonText);

  if (data?.type === 'doc') {
    return {
      version: 0,
      meta: { title: 'Untitled', author: '', color: '', page_count: 0, project_id: null, script_id: null },
      content: data,
      assets: [],
    };
  }

  throw new Error('Invalid .odraft file: unrecognized format');
}
