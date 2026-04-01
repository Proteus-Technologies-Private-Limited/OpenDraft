/**
 * Zip import utility — imports a .zip file as a new project.
 * Expects the zip structure produced by exportProjectAsZip:
 *   project.json
 *   scripts/
 *     {name}.meta.json
 *     {name}.json
 */

import JSZip from 'jszip';
import { api } from '../services/api';

/**
 * Import a zip file as a new project.
 * @returns The new project ID.
 */
export async function importProjectFromZip(input: File | ArrayBuffer): Promise<string> {
  const buf = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  // Read project metadata
  const projectJsonFile = zip.file('project.json');
  if (!projectJsonFile) {
    throw new Error('Invalid project archive: missing project.json');
  }

  const projectData = JSON.parse(await projectJsonFile.async('string'));
  const fallbackName = input instanceof File ? input.name.replace(/\.zip$/i, '') : '';
  const baseName = projectData.name || fallbackName || 'Imported Project';

  // Create project (append timestamp if slug conflict)
  let project;
  try {
    project = await api.createProject(baseName);
  } catch {
    const uniqueName = `${baseName} (${Date.now()})`;
    project = await api.createProject(uniqueName);
  }

  // Find all script content files in the scripts/ folder
  const scriptFiles = new Map<string, { meta?: string; content?: string }>();

  zip.forEach((path, entry) => {
    if (entry.dir) return;
    const match = path.match(/^scripts\/(.+)\.(meta\.json|json)$/);
    if (!match) return;
    const name = match[1];
    const type = match[2]; // 'meta.json' or 'json'
    if (!scriptFiles.has(name)) scriptFiles.set(name, {});
    const rec = scriptFiles.get(name)!;
    if (type === 'meta.json') rec.meta = path;
    else rec.content = path;
  });

  // Import each script
  const results = await Promise.allSettled(
    Array.from(scriptFiles.entries()).map(async ([name, files]) => {
      let title = name;
      let content: Record<string, unknown> = {};

      if (files.meta) {
        const metaText = await zip.file(files.meta)!.async('string');
        const meta = JSON.parse(metaText);
        title = meta.title || name;
      }

      if (files.content) {
        const contentText = await zip.file(files.content)!.async('string');
        content = JSON.parse(contentText);
      }

      await api.createScript(project.id, { title, content });
    }),
  );

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0 && failures.length < results.length) {
    console.warn(
      `Imported project with ${failures.length} script(s) that failed to import.`,
    );
  } else if (failures.length === results.length && results.length > 0) {
    throw new Error('All scripts failed to import');
  }

  return project.id;
}
