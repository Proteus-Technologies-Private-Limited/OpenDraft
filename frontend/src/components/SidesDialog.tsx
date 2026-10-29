/**
 * File → Export → Sides & Selected Pages…
 *
 * Sides: the scenes an actor needs for an audition or a day's shoot, on their
 * original pages with their original numbers, the rest of each page crossed
 * out. Or every page holding a character's lines, a location's scenes, or a
 * tagged item — Final Draft's "print pages with" — for the department that
 * only needs those.
 *
 * Also File → Print Selected Pages…: the same dialog, with Print as its main
 * button. Either way both are offered — the choice is what to put on paper,
 * and whether it is saved or printed is the last thing decided. Two pages to
 * a landscape sheet is an option for any of it.
 */
import React, { useMemo, useState } from 'react';
import type { JSONContent } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import type { PdfPageSelection } from '../utils/pdfExporter';
import {
  sceneRanges, scenesWithCharacter, speakingCharacters, buildPageSelection, type PageChoice,
} from '../utils/pageSelection';

/** What the dialog was opened for: its main button. */
export type SidesIntent = 'export' | 'print';

interface Props {
  doc: JSONContent;
  /** Which of Export and Print is the main button. Absent: export. */
  intent?: SidesIntent;
  /** Render and save the PDF; resolves once it is saved, rejects with the reason. */
  onExport: (selection: PdfPageSelection, fileSuffix: string) => Promise<void>;
  /** Render the PDF and send it to the printer; resolves once it is handed over. */
  onPrint: (selection: PdfPageSelection, fileSuffix: string) => Promise<void>;
  onClose: () => void;
}

type Mode = PageChoice['mode'];

const SidesDialog: React.FC<Props> = ({ doc, intent = 'export', onExport, onPrint, onClose }) => {
  const tags = useEditorStore((s) => s.tags);
  const tagCategories = useEditorStore((s) => s.tagCategories);
  const scenes = useMemo(() => sceneRanges(doc), [doc]);
  const characters = useMemo(() => speakingCharacters(doc), [doc]);
  const locations = useMemo(() => [...new Set(scenes.map((s) => s.location).filter(Boolean))].sort(), [scenes]);
  /** Tag names, each with every tag id that carries it. */
  const tagChoices = useMemo(() => {
    const byKey = new Map<string, { label: string; ids: string[] }>();
    for (const t of tags) {
      const name = (t.name || t.text || '').trim();
      if (!name) continue;
      const category = tagCategories.find((c) => c.id === t.categoryId)?.name ?? t.categoryId;
      const key = `${category}: ${name}`;
      const entry = byKey.get(key) ?? { label: key, ids: [] };
      entry.ids.push(t.id);
      byKey.set(key, entry);
    }
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [tags, tagCategories]);

  const [mode, setMode] = useState<Mode>('sides');
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [crossOut, setCrossOut] = useState(true);
  const [character, setCharacter] = useState(characters[0] ?? '');
  const [location, setLocation] = useState(locations[0] ?? '');
  const [tagKey, setTagKey] = useState(tagChoices[0]?.label ?? '');
  const [twoUp, setTwoUp] = useState(false);
  const [busy, setBusy] = useState<SidesIntent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleScene = (index: number) => {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const addScenesFor = (name: string) => {
    if (!name) return;
    setChosen((prev) => new Set([...prev, ...scenesWithCharacter(doc, name)]));
  };

  const choice = (): PageChoice | null => {
    switch (mode) {
      case 'sides': return { mode, scenes: chosen, crossOut };
      case 'character': return { mode, character };
      case 'location': return { mode, location };
      case 'tag': {
        const tag = tagChoices.find((t) => t.label === tagKey);
        return tag ? { mode, label: tag.label, tagIds: tag.ids } : null;
      }
    }
  };
  const build = () => {
    const picked = choice();
    return picked ? buildPageSelection(doc, picked, { twoUp }) : null;
  };

  const ready = build() !== null;

  const run = async (action: SidesIntent) => {
    const built = build();
    if (!built) return;
    setBusy(action);
    setError(null);
    try {
      await (action === 'print' ? onPrint : onExport)(built.selection, built.suffix);
      onClose();
    } catch (err) {
      console.error(`[sides] ${action} failed:`, err);
      const reason = err instanceof Error ? err.message : String(err);
      setError(action === 'print' ? `Could not print: ${reason}` : reason);
    } finally {
      setBusy(null);
    }
  };

  const exportButton = (
    <button
      key="export"
      className={intent === 'export' ? 'dialog-primary' : undefined}
      onClick={() => { void run('export'); }}
      disabled={!ready || busy !== null}
    >
      {busy === 'export' ? 'Exporting…' : 'Export PDF…'}
    </button>
  );
  const printButton = (
    <button
      key="print"
      className={intent === 'print' ? 'dialog-primary' : undefined}
      onClick={() => { void run('print'); }}
      disabled={!ready || busy !== null}
    >
      {busy === 'print' ? 'Preparing…' : 'Print…'}
    </button>
  );

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box sides-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sides-dialog-title"
      >
        <div className="dialog-header" id="sides-dialog-title">
          {intent === 'print' ? 'Print Selected Pages' : 'Sides & Selected Pages'}
        </div>
        <div className="dialog-body">
          <div className="sides-modes" role="radiogroup" aria-label="What to print">
            {([
              ['sides', 'Sides'],
              ['character', 'Pages with a character'],
              ['location', 'Pages at a location'],
              ['tag', 'Pages with a tag'],
            ] as Array<[Mode, string]>).map(([m, label]) => (
              <label key={m} className="sides-mode">
                <input type="radio" name="sides-mode" checked={mode === m} onChange={() => { setMode(m); setError(null); }} />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {mode === 'sides' && (
            <>
              <p className="sides-help">
                The chosen scenes on their own pages, keeping the script&rsquo;s page and scene numbers.
              </p>
              {characters.length > 0 && (
                <div className="sides-row">
                  <span>Add every scene with</span>
                  <select value={character} onChange={(e) => setCharacter(e.target.value)} aria-label="Character">
                    {characters.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button type="button" className="dialog-btn" onClick={() => addScenesFor(character)}>Add</button>
                </div>
              )}
              <div className="sides-scenes" role="group" aria-label="Scenes">
                {scenes.length === 0 && <p className="sides-help">This script has no scene headings.</p>}
                {scenes.map((s) => (
                  <label key={s.index} className="sides-scene">
                    <input type="checkbox" checked={chosen.has(s.index)} onChange={() => toggleScene(s.index)} />
                    <span className="sides-scene-number">{s.number}</span>
                    <span className="sides-scene-heading">{s.heading}</span>
                  </label>
                ))}
              </div>
              <div className="sides-row">
                <button type="button" className="dialog-btn" onClick={() => setChosen(new Set())} disabled={chosen.size === 0}>Clear</button>
                <span className="sides-count">{chosen.size} of {scenes.length} scenes</span>
              </div>
              <label className="sides-check">
                <input type="checkbox" checked={crossOut} onChange={(e) => setCrossOut(e.target.checked)} />
                <span>Cross out the rest of each page</span>
              </label>
            </>
          )}

          {mode === 'character' && (
            <label className="sides-row">
              <span>Character</span>
              <select value={character} onChange={(e) => setCharacter(e.target.value)}>
                {characters.length === 0 && <option value="">No speaking characters</option>}
                {characters.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}

          {mode === 'location' && (
            <label className="sides-row">
              <span>Location</span>
              <select value={location} onChange={(e) => setLocation(e.target.value)}>
                {locations.length === 0 && <option value="">No locations</option>}
                {locations.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          )}

          {mode === 'tag' && (
            <label className="sides-row">
              <span>Tag</span>
              <select value={tagKey} onChange={(e) => setTagKey(e.target.value)}>
                {tagChoices.length === 0 && <option value="">No production tags</option>}
                {tagChoices.map((t) => <option key={t.label} value={t.label}>{t.label}</option>)}
              </select>
            </label>
          )}

          <label className="sides-check">
            <input type="checkbox" checked={twoUp} onChange={(e) => setTwoUp(e.target.checked)} />
            <span>Two pages per sheet (landscape)</span>
          </label>

          {error && <p className="revision-settings-error" role="alert">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          {/* The main button last, where the dialog's other actions put it. */}
          {intent === 'print' ? [exportButton, printButton] : [printButton, exportButton]}
        </div>
      </div>
    </div>
  );
};

export default SidesDialog;
