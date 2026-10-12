/**
 * Carrying an opened .fdx's unmodelled sections through a save.
 *
 * exportFDX writes the sections WriTea Draft understands. A Final Draft file
 * has many more (Macros, Cast, SmartType, Outlines, ScriptNotes, ...). They are
 * captured, untouched, when the file is opened, kept with the document, and
 * written back on save for every section the export did not write itself, so a
 * round trip loses nothing that the app does not edit.
 */
export interface FdxRaw {
  /** The file's own root `Version` attribute. */
  version: string;
  /** Top-level section tag -> its XML, exactly as the file had it. */
  sections: Record<string, string>;
}

/** Sections exportFDX always writes itself, so the original is never needed. */
const WRITTEN_BY_EXPORTER = new Set(['Content', 'PageLayout', 'ElementSettings', 'HeaderAndFooter', 'TitlePage']);

export function isFdxRaw(v: unknown): v is FdxRaw {
  if (!v || typeof v !== 'object') return false;
  const s = (v as { sections?: unknown }).sections;
  return !!s && typeof s === 'object';
}

export function captureFdxRaw(xml: string): FdxRaw | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const root = doc.documentElement;
    if (!root || root.nodeName !== 'FinalDraft' || doc.querySelector('parsererror')) return null;
    const ser = new XMLSerializer();
    const sections: Record<string, string> = {};
    for (const child of Array.from(root.children)) {
      if (WRITTEN_BY_EXPORTER.has(child.tagName) || child.tagName in sections) continue;
      sections[child.tagName] = ser.serializeToString(child);
    }
    return { version: root.getAttribute('Version') ?? '', sections };
  } catch (err) {
    console.warn('[fdx] could not keep the original sections', err);
    return null;
  }
}

/** Add every remembered section the freshly exported XML does not already have. */
export function mergeFdxRaw(xml: string, raw: FdxRaw | null | undefined): string {
  if (!raw || !raw.sections) return xml;
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return xml;
    const present = new Set(Array.from(doc.documentElement.children).map((c) => c.tagName));
    const missing = Object.entries(raw.sections).filter(([tag]) => !present.has(tag));
    if (missing.length === 0) return xml;
    const close = xml.lastIndexOf('</FinalDraft>');
    if (close < 0) return xml;
    const block = missing.map(([, s]) => '  ' + s).join('\n\n');
    let out = xml.slice(0, close) + '\n' + block + '\n' + xml.slice(close);
    if (raw.version) out = out.replace(/^(<FinalDraft[^>]*\sVersion=")[^"]*(")/m, '$1' + raw.version + '$2');
    return out;
  } catch (err) {
    console.warn('[fdx] could not add the original sections back', err);
    return xml;
  }
}
