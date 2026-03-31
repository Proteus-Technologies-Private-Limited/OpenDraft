/**
 * Zip export utilities for projects and individual scripts.
 * Exports files in the same internal format (TipTap JSON + meta JSON).
 */

import JSZip from 'jszip';
import { api } from '../services/api';

/** Sanitize a string for use as a filename. */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'untitled';
}

/** De-duplicate filenames by appending (2), (3), etc. */
function dedup(names: string[]): string[] {
  const counts = new Map<string, number>();
  return names.map((n) => {
    const lower = n.toLowerCase();
    const count = (counts.get(lower) || 0) + 1;
    counts.set(lower, count);
    return count > 1 ? `${n} (${count})` : n;
  });
}

/** Export a single script as a zip containing its content and meta JSON. */
export async function exportScriptAsZip(
  projectId: string,
  scriptId: string,
): Promise<void> {
  const resp = await api.getScript(projectId, scriptId);
  const title = sanitizeFilename(resp.meta.title || 'Untitled');

  const zip = new JSZip();
  const { id: _id, sort_order: _so, size_bytes: _sb, ...metaClean } = resp.meta;
  zip.file(`${title}.meta.json`, JSON.stringify(metaClean, null, 2));
  zip.file(`${title}.json`, JSON.stringify(resp.content || {}, null, 2));

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${title}.zip`);
}

/** Export an entire project as a zip with project.json + scripts/ folder. */
export async function exportProjectAsZip(projectId: string): Promise<void> {
  const project = await api.getProject(projectId);
  const scriptMetas = await api.listScripts(projectId);

  const zip = new JSZip();

  // Project metadata
  const { color: _c, pinned: _p, sort_order: _so, ...projectClean } = project;
  zip.file('project.json', JSON.stringify(projectClean, null, 2));

  if (scriptMetas.length > 0) {
    const scriptsFolder = zip.folder('scripts')!;
    const rawNames = scriptMetas.map((m) => sanitizeFilename(m.title || 'Untitled'));
    const fileNames = dedup(rawNames);

    // Fetch all script contents in parallel
    const contents = await Promise.all(
      scriptMetas.map((m) =>
        api.getScript(projectId, m.id).catch(() => null),
      ),
    );

    for (let i = 0; i < scriptMetas.length; i++) {
      const resp = contents[i];
      if (!resp) continue;
      const name = fileNames[i];
      const { id: _id, sort_order: _so2, size_bytes: _sb, ...metaClean } = resp.meta;
      scriptsFolder.file(`${name}.meta.json`, JSON.stringify(metaClean, null, 2));
      scriptsFolder.file(`${name}.json`, JSON.stringify(resp.content || {}, null, 2));
    }
  }

  const projectName = sanitizeFilename(project.name || 'project');
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${projectName}.zip`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
