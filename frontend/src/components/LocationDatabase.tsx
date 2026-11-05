import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { api, type LocationEntry } from '../services/api';
import { showToast } from './Toast';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import { blockContentRange, singleLine } from '../utils/nodeText';
import Select from './Select';

interface Props {
  editor: Editor | null;
  style?: React.CSSProperties;
}

/** The label shown for a stored location type (the stored value stays 'interior' etc.). */
function typeLabel(t: TFunction<['story', 'common']>, type: string): string {
  switch (type) {
    case 'interior': return t('locations.type.interior');
    case 'exterior': return t('locations.type.exterior');
    case 'both': return t('locations.type.both');
    default: return type;
  }
}

/** Parse location name from a scene heading string. */
const PREFIX_RE = /^(INT\.?\/?EXT\.?|EXT\.?\/?INT\.?|INT\.?|EXT\.?|I\/E\.?)\s+/i;
const TIME_WORDS = 'DAY|NIGHT|DAWN|DUSK|MORNING|AFTERNOON|EVENING|SUNSET|SUNRISE|LATER|CONTINUOUS|SAME TIME|MOMENTS LATER|SAME|MAGIC HOUR';

function parseLocationFromHeading(heading: string): string {
  let rest = heading.trim();
  const prefix = rest.match(PREFIX_RE);
  if (prefix && prefix.index !== undefined) rest = rest.slice(prefix.index + prefix[0].length);
  const dashTime = rest.match(new RegExp(`\\s+-\\s+(${TIME_WORDS})\\.?$`, 'i'));
  if (dashTime) rest = rest.slice(0, -dashTime[0].length);
  else {
    const dotTime = rest.match(new RegExp(`\\.\\s*(${TIME_WORDS})\\.?$`, 'i'));
    if (dotTime) rest = rest.slice(0, -dotTime[0].length);
  }
  return rest.replace(/^[\s.]+|[\s.]+$/g, '').toUpperCase();
}

const LocationDatabase: React.FC<Props> = ({ editor, style }) => {
  const { t } = useTranslation(['story', 'common']);
  const { locationDatabaseOpen, toggleLocationDatabase, scenes } = useEditorStore();
  const { currentProject } = useProjectStore();
  const [locations, setLocations] = useState<LocationEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<LocationEntry>>({});
  const [search, setSearch] = useState('');

  const panelRef = useRef<HTMLDivElement>(null);

  const { shouldRender, animationState } = useDelayedUnmount(locationDatabaseOpen, 250);
  useSwipeDismiss(panelRef, { direction: 'right', onDismiss: toggleLocationDatabase, enabled: shouldRender });

  // Load locations when panel opens or project changes
  useEffect(() => {
    if (!locationDatabaseOpen || !currentProject) return;
    let cancelled = false;
    setLoading(true);
    api.listLocations(currentProject.id)
      .then((list) => { if (!cancelled) setLocations(list); })
      .catch((err) => {
        if (!cancelled) showToast(err instanceof Error ? err.message : t('locations.loadFailed'), 'error');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [locationDatabaseOpen, currentProject, t]);

  // Map location name → scenes referencing it, derived from current scenes store
  const locationSceneCounts = useMemo(() => {
    const counts = new Map<string, number[]>();
    scenes.forEach((scene, i) => {
      const name = parseLocationFromHeading(scene.heading);
      if (!name) return;
      if (!counts.has(name)) counts.set(name, []);
      counts.get(name)!.push(i);
    });
    return counts;
  }, [scenes]);

  const getSceneCount = useCallback((loc: LocationEntry): number => {
    const fromName = locationSceneCounts.get(loc.name)?.length || 0;
    const fromAliases = loc.aliases.reduce((sum, a) => sum + (locationSceneCounts.get(a)?.length || 0), 0);
    return fromName + fromAliases;
  }, [locationSceneCounts]);

  const discovered = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    try {
      const result = await api.discoverLocations(currentProject.id);
      setLocations(result.locations);
      if (result.discovered > 0) {
        showToast(t('locations.discovered', { count: result.discovered }), 'success');
      } else {
        showToast(t('locations.noneFound'), 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('locations.discoveryFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [currentProject, t]);

  const startEdit = useCallback((loc: LocationEntry) => {
    setEditingId(loc.id);
    setDraft({ ...loc });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setDraft({});
  }, []);

  const saveEdit = useCallback(async () => {
    if (!currentProject || !editingId) return;
    try {
      const updated = await api.updateLocation(currentProject.id, editingId, draft);
      setLocations((prev) => prev.map((l) => (l.id === editingId ? updated : l)));
      setEditingId(null);
      setDraft({});
      showToast(t('locations.updated'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('locations.saveFailed'), 'error');
    }
  }, [currentProject, editingId, draft, t]);

  const handleDelete = useCallback(async (loc: LocationEntry) => {
    if (!currentProject) return;
    if (!window.confirm(t('locations.confirmDelete', { name: loc.name }))) return;
    try {
      await api.deleteLocation(currentProject.id, loc.id);
      setLocations((prev) => prev.filter((l) => l.id !== loc.id));
      if (selectedId === loc.id) setSelectedId(null);
      showToast(t('locations.deleted'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('locations.deleteFailed'), 'error');
    }
  }, [currentProject, selectedId, t]);

  const handleRenameInHeadings = useCallback((loc: LocationEntry, newName: string) => {
    if (!editor) return;
    const oldName = loc.name;
    const canonical = newName.trim().toUpperCase();
    if (!canonical || canonical === oldName) return;
    const { state } = editor;
    const { tr } = state;
    let changed = 0;
    let skippedBroken = 0;
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'sceneHeading') return true;
      const text = node.textContent;
      // A heading containing a hard break can't be rewritten: insertText over
      // the inline range would flatten the break into plain text. Skip it and
      // report, rather than silently reformatting the writer's content.
      if (text.includes('\n')) {
        if (parseLocationFromHeading(singleLine(text)) === oldName) skippedBroken++;
        return true;
      }
      const parsed = parseLocationFromHeading(text);
      if (parsed !== oldName) return true;
      // Replace the location portion in the heading
      const newText = text.replace(new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), canonical);
      if (newText === text) return true;
      // Derive the range from nodeSize, never `pos + 1 + text.length` — the
      // latter is short by one per inline atom, leaving the heading's tail
      // behind and duplicating it.
      const { from, to } = blockContentRange(node, pos);
      tr.insertText(newText, from, to);
      changed++;
      return true;
    });
    if (changed > 0) editor.view.dispatch(tr);
    if (skippedBroken > 0) {
      showToast(
        t('locations.skippedHeadings', { count: skippedBroken }),
        'info',
      );
    }
    return changed;
  }, [editor, t]);

  const goToScene = useCallback((sceneIndex: number) => {
    if (!editor) return;
    const { doc } = editor.state;
    let currentScene = -1;
    let targetPos = 0;
    doc.descendants((node, pos) => {
      if (node.type.name === 'sceneHeading') {
        currentScene++;
        if (currentScene === sceneIndex) { targetPos = pos; return false; }
      }
      return true;
    });
    editor.chain().focus().setTextSelection(targetPos + 1).run();
  }, [editor]);

  const filteredLocations = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return locations;
    return locations.filter((l) =>
      l.name.includes(q) ||
      l.fullName.toUpperCase().includes(q) ||
      l.aliases.some((a) => a.includes(q)) ||
      l.address.toUpperCase().includes(q),
    );
  }, [locations, search]);

  const selected = selectedId ? locations.find((l) => l.id === selectedId) : null;

  if (!shouldRender) return null;

  const panelClass = animationState === 'entered' ? 'panel-open'
    : animationState === 'exiting' ? 'panel-closing' : '';

  return (
    <div ref={panelRef} className={`location-database ${panelClass}`} style={style}>
      <div className="location-db-header">
        <span className="location-db-title">{t('locations.title')}</span>
        <button
          className="location-db-discover"
          onClick={discovered}
          disabled={loading}
          title={t('locations.discoverTitle')}
        >
          {loading ? t('locations.scanning') : t('locations.discover')}
        </button>
        <button className="location-db-close" onClick={toggleLocationDatabase} title={t('common:close')}>×</button>
      </div>

      <div className="location-db-search">
        <input
          type="text"
          placeholder={t('locations.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="location-db-body">
        <div className="location-db-list">
          {loading && locations.length === 0 ? (
            <div className="location-db-empty">{t('common:loading')}</div>
          ) : filteredLocations.length === 0 ? (
            <div className="location-db-empty">
              {locations.length === 0
                ? t('locations.emptyNone')
                : t('locations.emptyNoMatch')}
            </div>
          ) : (
            filteredLocations.map((loc) => (
              <div
                key={loc.id}
                className={`location-db-card${selectedId === loc.id ? ' selected' : ''}`}
                onClick={() => setSelectedId(loc.id)}
              >
                <div className="location-db-card-header">
                  <span className="location-db-card-name">{loc.name}</span>
                  <span className="location-db-card-count">{getSceneCount(loc)}</span>
                </div>
                <div className="location-db-card-meta">
                  <span className={`location-db-type location-db-type-${loc.type}`}>
                    {typeLabel(t, loc.type)}
                  </span>
                  {loc.address && <span className="location-db-card-address">{loc.address}</span>}
                </div>
                {loc.tags.length > 0 && (
                  <div className="location-db-card-tags">
                    {loc.tags.map((tag) => (
                      <span key={tag} className="location-db-tag">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {selected && (
          <div className="location-db-detail">
            {editingId === selected.id ? (
              <LocationEditor
                draft={draft}
                setDraft={setDraft}
                onSave={saveEdit}
                onCancel={cancelEdit}
                originalName={selected.name}
                onRenameHeadings={(newName) => {
                  const n = handleRenameInHeadings(selected, newName);
                  if (n && n > 0) showToast(t('locations.renamedHeadings', { count: n }), 'success');
                }}
              />
            ) : (
              <LocationDetailView
                loc={selected}
                sceneIndices={
                  (locationSceneCounts.get(selected.name) || [])
                    .concat(...selected.aliases.map((a) => locationSceneCounts.get(a) || []))
                }
                scenes={scenes}
                onEdit={() => startEdit(selected)}
                onDelete={() => handleDelete(selected)}
                onGoToScene={goToScene}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────

interface DetailViewProps {
  loc: LocationEntry;
  sceneIndices: number[];
  scenes: Array<{ id: string; heading: string; synopsis: string; color: string; sceneNumber?: string | null }>;
  onEdit: () => void;
  onDelete: () => void;
  onGoToScene: (sceneIndex: number) => void;
}

const LocationDetailView: React.FC<DetailViewProps> = ({ loc, sceneIndices, scenes, onEdit, onDelete, onGoToScene }) => {
  const { t } = useTranslation(['story', 'common']);
  return (
  <>
    <div className="location-db-detail-header">
      <h3>{loc.name}</h3>
      <div className="location-db-detail-actions">
        <button onClick={onEdit}>{t('common:edit')}</button>
        <button onClick={onDelete} className="location-db-danger">{t('common:delete')}</button>
      </div>
    </div>
    {loc.fullName && <div className="location-db-field"><label>{t('locations.fullName')}</label><div>{loc.fullName}</div></div>}
    <div className="location-db-field"><label>{t('locations.typeLabel')}</label><div>{typeLabel(t, loc.type)}</div></div>
    {loc.address && <div className="location-db-field"><label>{t('locations.address')}</label><div>{loc.address}</div></div>}
    {loc.contact && <div className="location-db-field"><label>{t('locations.contact')}</label><div>{loc.contact}</div></div>}
    {loc.availability && <div className="location-db-field"><label>{t('locations.availability')}</label><div>{loc.availability}</div></div>}
    {loc.notes && <div className="location-db-field"><label>{t('locations.notes')}</label><div style={{ whiteSpace: 'pre-wrap' }}>{loc.notes}</div></div>}
    {loc.aliases.length > 0 && <div className="location-db-field"><label>{t('locations.aliases')}</label><div>{loc.aliases.join(', ')}</div></div>}
    {loc.tags.length > 0 && (
      <div className="location-db-field">
        <label>{t('locations.tags')}</label>
        <div className="location-db-card-tags">
          {loc.tags.map((tag) => <span key={tag} className="location-db-tag">{tag}</span>)}
        </div>
      </div>
    )}
    <div className="location-db-field">
      <label>{t('locations.scenes', { count: sceneIndices.length })}</label>
      <div className="location-db-scenes">
        {sceneIndices.length === 0 ? (
          <em>{t('locations.noScenes')}</em>
        ) : (
          sceneIndices.map((sceneIdx) => {
            const scene = scenes[sceneIdx];
            if (!scene) return null;
            return (
              <div key={sceneIdx} className="location-db-scene-row" onClick={() => onGoToScene(sceneIdx)}>
                <span className="location-db-scene-num">{sceneIdx + 1}</span>
                <span className="location-db-scene-heading">{scene.heading}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  </>
  );
};

interface EditorProps {
  draft: Partial<LocationEntry>;
  setDraft: React.Dispatch<React.SetStateAction<Partial<LocationEntry>>>;
  onSave: () => void;
  onCancel: () => void;
  originalName: string;
  onRenameHeadings: (newName: string) => void;
}

const LocationEditor: React.FC<EditorProps> = ({ draft, setDraft, onSave, onCancel, originalName, onRenameHeadings }) => {
  const { t } = useTranslation(['story', 'common']);
  const set = (patch: Partial<LocationEntry>) => setDraft((d) => ({ ...d, ...patch }));
  const currentName = (draft.name || '').toUpperCase();
  const nameChanged = currentName !== originalName && currentName.length > 0;

  return (
    <>
      <div className="location-db-detail-header">
        <h3>{t('locations.editTitle')}</h3>
        <div className="location-db-detail-actions">
          <button onClick={onCancel}>{t('common:cancel')}</button>
          <button onClick={onSave} className="location-db-primary">{t('common:save')}</button>
        </div>
      </div>
      <div className="location-db-field">
        <label>{t('common:name')}</label>
        <input value={draft.name || ''} onChange={(e) => set({ name: e.target.value.toUpperCase() })} />
        {nameChanged && (
          <button
            className="location-db-secondary"
            style={{ marginTop: 4 }}
            onClick={() => onRenameHeadings(currentName)}
          >
            {t('locations.renameInHeadings')}
          </button>
        )}
      </div>
      <div className="location-db-field">
        <label>{t('locations.fullName')}</label>
        <input value={draft.fullName || ''} onChange={(e) => set({ fullName: e.target.value })} />
      </div>
      <div className="location-db-field">
        <label>{t('locations.typeLabel')}</label>
        <Select value={draft.type || 'interior'} onChange={(e) => set({ type: e.target.value as LocationEntry['type'] })}>
          <option value="interior">{t('locations.type.interior')}</option>
          <option value="exterior">{t('locations.type.exterior')}</option>
          <option value="both">{t('locations.type.both')}</option>
        </Select>
      </div>
      <div className="location-db-field">
        <label>{t('locations.address')}</label>
        <input value={draft.address || ''} onChange={(e) => set({ address: e.target.value })} />
      </div>
      <div className="location-db-field">
        <label>{t('locations.contact')}</label>
        <input value={draft.contact || ''} onChange={(e) => set({ contact: e.target.value })} />
      </div>
      <div className="location-db-field">
        <label>{t('locations.availability')}</label>
        <input value={draft.availability || ''} onChange={(e) => set({ availability: e.target.value })} />
      </div>
      <div className="location-db-field">
        <label>{t('locations.notes')}</label>
        <textarea
          value={draft.notes || ''}
          onChange={(e) => set({ notes: e.target.value })}
          rows={4}
        />
      </div>
      <div className="location-db-field">
        <label>{t('locations.aliasesInput')}</label>
        <input
          value={(draft.aliases || []).join(', ')}
          onChange={(e) => set({ aliases: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) })}
        />
      </div>
      <div className="location-db-field">
        <label>{t('locations.tagsInput')}</label>
        <input
          value={(draft.tags || []).join(', ')}
          onChange={(e) => set({ tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
      </div>
    </>
  );
};

export default LocationDatabase;
