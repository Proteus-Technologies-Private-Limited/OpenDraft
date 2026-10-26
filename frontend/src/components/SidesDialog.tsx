/**
 * File → Export → Sides & Selected Pages…
 *
 * Sides: the scenes an actor needs for an audition or a day's shoot, on their
 * original pages with their original numbers, the rest of each page crossed
 * out. Or every page holding a character's lines, a location's scenes, or a
 * tagged item — Final Draft's "print pages with" — for the department that
 * only needs those.
 */
import React, { useMemo, useState } from 'react';
import type { JSONContent } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import type { PdfPageSelection } from '../utils/pdfExporter';
import {
  sceneRanges, keepScenes, keepCharacter, keepLocation, keepTags,
  scenesWithCharacter, speakingCharacters,
} from '../utils/pageSelection';

interface Props {
  doc: JSONContent;
  /** Render and save the PDF; resolves once it is saved, rejects with the reason. */
  onExport: (selection: PdfPageSelection, fileSuffix: string) => Promise<void>;
  onClose: () => void;
}

type Mode = 'sides' | 'character' | 'location' | 'tag';

const SidesDialog: React.FC<Props> = ({ doc, onExport, onClose }) => {
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
  const [busy, setBusy] = useState(false);
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

  const build = (): { selection: PdfPageSelection; suffix: string } | null => {
    switch (mode) {
      case 'sides': {
        if (chosen.size === 0) return null;
        const numbers = scenes.filter((s) => chosen.has(s.index)).map((s) => s.number);
        return {
          selection: {
            keep: keepScenes(doc, chosen),
            crossOutOthers: crossOut,
            emptyMessage: 'The chosen scenes are empty.',
          },
          suffix: `Sides (Sc. ${numbers.join(', ')})`,
        };
      }
      case 'character':
        if (!character) return null;
        return {
          selection: { keep: keepCharacter(doc, character), emptyMessage: `${character} has no lines in this script.` },
          suffix: `Pages with ${character}`,
        };
      case 'location':
        if (!location) return null;
        return {
          selection: { keep: keepLocation(doc, location), emptyMessage: `No scene is set at ${location}.` },
          suffix: `Pages at ${location}`,
        };
      case 'tag': {
        const choice = tagChoices.find((t) => t.label === tagKey);
        if (!choice) return null;
        return {
          selection: { keep: keepTags(doc, choice.ids), emptyMessage: `Nothing in the script is tagged ${choice.label}.` },
          suffix: `Pages with ${choice.label.replace(/:/g, ' -')}`,
        };
      }
    }
  };

  const ready = build() !== null;

  const run = async () => {
    const built = build();
    if (!built) return;
    setBusy(true);
    setError(null);
    try {
      await onExport(built.selection, built.suffix);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box sides-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sides-dialog-title"
      >
        <div className="dialog-header" id="sides-dialog-title">Sides &amp; Selected Pages</div>
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

          {error && <p className="revision-settings-error" role="alert">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="dialog-primary" onClick={() => { void run(); }} disabled={!ready || busy}>
            {busy ? 'Exporting…' : 'Export PDF…'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SidesDialog;
