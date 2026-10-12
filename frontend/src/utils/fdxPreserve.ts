import { resolveMoresContds } from '../stores/editorStore';
import type { PageLayout } from '../stores/editorStore';

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

/** The automatic character-continued marker in force, or '' when that setting is off. */
export function autoContdMarker(layout: PageLayout | undefined): string {
  const mc = resolveMoresContds(layout);
  return mc.characterContd ? (mc.contdText.trim() || "(CONT'D)") : '';
}

/** A character cue without the trailing automatic continued marker. */
export function stripAutoContd(text: string, marker: string): string {
  if (!marker) return text;
  const re = new RegExp('\\s*' + marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
  return text.replace(re, '');
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The `<SceneProperties>` block for a scene heading. The original block (arc
 * beats, page, length) is written back as it was; only the synopsis, which the
 * app lets the writer edit, is patched in. Without an original it is just the
 * synopsis, or nothing when there is none.
 */
export function sceneProperties(raw: unknown, synopsis: unknown, indent: string): string {
  const syn = typeof synopsis === 'string' ? synopsis.trim() : '';
  if (typeof raw === 'string' && raw) {
    try {
      const doc = new DOMParser().parseFromString(raw, 'text/xml');
      const sp = doc.documentElement;
      if (!doc.querySelector('parsererror') && sp.tagName === 'SceneProperties') {
        const summary = Array.from(sp.children).find((c) => c.tagName === 'Summary');
        const current = (summary?.textContent ?? '').trim();
        if (current !== syn) {
          if (!syn) {
            summary?.remove();
          } else {
            let target = summary;
            if (!target) {
              target = doc.createElement('Summary');
              sp.insertBefore(target, sp.firstChild);
            }
            target.textContent = '';
            const p = doc.createElement('Paragraph');
            const t = doc.createElement('Text');
            t.textContent = syn;
            p.appendChild(t);
            target.appendChild(p);
          }
        }
        return indent + new XMLSerializer().serializeToString(sp);
      }
    } catch (err) {
      console.warn('[fdx] could not reuse the original scene properties', err);
    }
  }
  if (!syn) return '';
  return [
    indent + '<SceneProperties>',
    indent + '  <Summary>',
    indent + '    <Paragraph>',
    indent + '      <Text>' + xmlEsc(syn) + '</Text>',
    indent + '    </Paragraph>',
    indent + '  </Summary>',
    indent + '</SceneProperties>',
  ].join('\n');
}
