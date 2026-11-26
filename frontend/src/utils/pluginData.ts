/**
 * Plugin document data on disk and in other formats.
 *
 * The data itself lives in stores/pluginDataStore.ts. This module reads it
 * back from a saved payload, and carries it through the two text formats a
 * script most often round-trips through:
 *
 * - FDX: an `<OpenDraftPluginData>` element after `<Content>`, one `<Plugin>`
 *   child per plugin holding its JSON as text. Final Draft ignores elements it
 *   does not know; OpenDraft reads it back on import.
 * - Fountain: a boneyard block at the end of the file,
 *   `/* OpenDraft plugin data` … `*\/`, holding the JSON. Boneyard is never
 *   printed by any Fountain app.
 *
 * Neither changes how the script itself reads or prints.
 */
import type { PluginDocumentData } from '../stores/pluginDataStore';

/** The saved-payload key. */
export const PLUGIN_DATA_KEY = '_pluginData';

/** The largest serialized entry one plugin may keep in a script (2 MB). */
export const MAX_PLUGIN_DATA_BYTES = 2 * 1024 * 1024;

const FOUNTAIN_MARKER = 'OpenDraft plugin data';
const FDX_ELEMENT = 'OpenDraftPluginData';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whatever a payload or file holds under `_pluginData`, as a clean map: an
 * object (or a JSON string of one, as some backends store metadata) whose keys
 * are plugin ids. Anything else reads as no data.
 */
export function normalizePluginData(raw: unknown): PluginDocumentData {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (err) {
      console.warn('[plugin data] ignoring unreadable plugin data', err);
      return {};
    }
  }
  if (!isPlainObject(value)) return {};
  const out: PluginDocumentData = {};
  for (const [id, entry] of Object.entries(value)) {
    if (id && entry !== undefined) out[id] = entry;
  }
  return out;
}

/**
 * A plugin's value as stored: a JSON copy, so later changes to the caller's
 * object cannot reach the script behind the store's back. Throws with a
 * message the plugin can show when the value cannot be saved.
 */
export function toStorableEntry(pluginId: string, value: unknown): unknown {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (err) {
    throw new Error(`${pluginId}: this data cannot be saved with the script (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (json === undefined) {
    throw new Error(`${pluginId}: this data cannot be saved with the script (it is not JSON).`);
  }
  if (json.length > MAX_PLUGIN_DATA_BYTES) {
    throw new Error(`${pluginId}: this data is too large to keep in the script (${Math.round(json.length / 1024)} KB; the limit is ${MAX_PLUGIN_DATA_BYTES / 1024} KB).`);
  }
  return JSON.parse(json);
}

/** True when there is at least one plugin entry worth writing. */
export function hasPluginData(data: PluginDocumentData | null | undefined): data is PluginDocumentData {
  return !!data && Object.keys(data).length > 0;
}

// ── FDX ──

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The FDX lines for plugin data, indented to sit inside `<FinalDraft>`; none when empty. */
export function pluginDataFdxLines(data: PluginDocumentData | null | undefined): string[] {
  if (!hasPluginData(data)) return [];
  const lines = [`  <${FDX_ELEMENT}>`];
  for (const [id, entry] of Object.entries(data)) {
    let json: string;
    try {
      json = JSON.stringify(entry);
    } catch (err) {
      console.warn(`[plugin data] could not write ${id}'s data to the .fdx`, err);
      continue;
    }
    lines.push(`    <Plugin Id="${escapeXml(id)}">${escapeXml(json)}</Plugin>`);
  }
  lines.push(`  </${FDX_ELEMENT}>`);
  return lines;
}

/** Child elements by tag name — `childNodes`, which every XML DOM has. */
function childElements(parent: Element, tag: string): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === 1 && (node as Element).tagName === tag,
  );
}

/** Plugin data an FDX document carries; empty when it has none. */
export function readFdxPluginData(xmlDoc: Document): PluginDocumentData {
  const out: PluginDocumentData = {};
  const root = xmlDoc.documentElement;
  if (!root) return out;
  for (const holder of childElements(root, FDX_ELEMENT)) {
    for (const plugin of childElements(holder, 'Plugin')) {
      const id = plugin.getAttribute('Id');
      if (!id) continue;
      try {
        out[id] = JSON.parse(plugin.textContent ?? '');
      } catch (err) {
        console.warn(`[plugin data] the .fdx holds unreadable data for ${id}; it was left out`, err);
      }
    }
  }
  return out;
}

// ── Fountain ──

/**
 * The boneyard block that carries plugin data at the end of a Fountain file;
 * empty when there is none. JSON never contains `*\/` outside a string, and
 * inside one the `/` is escaped as `\/` (valid JSON), so the block can always
 * be closed safely.
 */
export function pluginDataFountainBlock(data: PluginDocumentData | null | undefined): string {
  if (!hasPluginData(data)) return '';
  let json: string;
  try {
    json = JSON.stringify(data, null, 1);
  } catch (err) {
    console.warn('[plugin data] could not write plugin data to the Fountain file', err);
    return '';
  }
  return `/* ${FOUNTAIN_MARKER}\n${json.replace(/\*\//g, '*\\/')}\n*/`;
}

/**
 * Take the plugin-data block out of Fountain text. Returns the text without it
 * (so the parser never sees it) and the data it held. Other boneyard is left
 * alone for the parser to discard as before.
 */
export function extractFountainPluginData(text: string): { text: string; data: PluginDocumentData } {
  const start = text.lastIndexOf(`/* ${FOUNTAIN_MARKER}`);
  if (start < 0) return { text, data: {} };
  const end = text.indexOf('*/', start);
  if (end < 0) return { text, data: {} };
  const body = text.slice(start + `/* ${FOUNTAIN_MARKER}`.length, end).trim();
  let data: PluginDocumentData = {};
  try {
    data = normalizePluginData(JSON.parse(body));
  } catch (err) {
    console.warn('[plugin data] the Fountain file holds unreadable plugin data; it was left out', err);
  }
  return { text: (text.slice(0, start) + text.slice(end + 2)).replace(/\s+$/, '\n'), data };
}
