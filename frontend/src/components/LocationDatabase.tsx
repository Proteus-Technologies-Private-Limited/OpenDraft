/**
 * Location Profiles: the project's locations, and one location at a time on
 * three tabs — Details (images, what it looks like, its looks, aliases and
 * tags), Production (address, contact, availability, notes) and Scenes.
 *
 * The Scenes tab is the cross-view "one location, all scenes with their
 * settings": for each scene set there, which look it shows, how the place
 * differs in that scene, and who is there in what — the look and setting
 * note are kept on the scene heading (utils/sceneDetails) and edited here or
 * in Scene Details alike.
 *
 * Records are per project (stores/locationStore), saved field by field as the
 * writer leaves each one.
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { useAssetStore } from '../stores/assetStore';
import { useLocationStore } from '../stores/locationStore';
import { api, type LocationEntry, type LocationLook } from '../services/api';
import { showToast } from './Toast';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import { useEditorDoc } from '../hooks/useEditorTransactions';
import { blockContentRange, singleLine } from '../utils/nodeText';
import { lookForScene, locationNamed, newLookId, normalizeLocationName, parseLocationFromHeading } from '../utils/locationData';
import { collectSceneBriefs, costumesIn, type SceneBrief } from '../utils/sceneDetails';
import { goToPosition, useNarrowPanel, writeSceneDetails, jumpToPanel } from '../utils/storyPanels';
import { AssetImagePicker, ImageLightbox, ReferenceImageGallery } from './ReferenceImages';
import { DraftText, ImageSlot, StoryPanelHeader, StoryPanelTabs } from './StoryPanelParts';
import Select from './Select';

interface Props {
  editor: Editor | null;
  style?: React.CSSProperties;
}

type LocationTab = 'details' | 'production' | 'scenes';
const LOCATION_TABS: readonly LocationTab[] = ['details', 'production', 'scenes'];
const TYPES: readonly LocationEntry['type'][] = ['interior', 'exterior', 'both'];

/**
 * Below this width the list and the detail cannot share the panel: the list
 * takes 250px, and the docked panel opens at 300px (280px on a phone), which
 * left the detail — and its Delete button — about 120px, scrolling sideways.
 * A narrow panel shows one at a time instead.
 */
const SIDE_BY_SIDE_MIN_WIDTH = 560;

/** An error the API client already put a dialog up for (sign-in, quota). */
function alreadyReported(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { handled?: unknown }).handled === true;
}

const LocationDatabase: React.FC<Props> = ({ editor, style }) => {
  const { t } = useTranslation(['story', 'common']);
  const locationDatabaseOpen = useEditorStore((s) => s.locationDatabaseOpen);
  const toggleLocationDatabase = useEditorStore((s) => s.toggleLocationDatabase);
  const profiles = useEditorStore((s) => s.characterProfiles);
  const profileFocus = useEditorStore((s) => s.profileFocus);
  const setProfileFocus = useEditorStore((s) => s.setProfileFocus);
  const { currentProject } = useProjectStore();
  const projectId = currentProject?.id ?? null;

  const locations = useLocationStore((s) => s.locations);
  const loading = useLocationStore((s) => s.loading);
  const loadError = useLocationStore((s) => s.error);
  const loadLocations = useLocationStore((s) => s.load);
  const updateLocation = useLocationStore((s) => s.update);
  const createLocation = useLocationStore((s) => s.create);
  const removeLocation = useLocationStore((s) => s.remove);
  const discoverLocations = useLocationStore((s) => s.discover);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<LocationTab>('details');
  const [search, setSearch] = useState('');
  const [isWide, setIsWide] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; headings: boolean } | null>(null);
  const [newLook, setNewLook] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [newTag, setNewTag] = useState('');

  // Reference images. A location keeps asset ids; the images are project assets.
  const { assets, setAssets } = useAssetStore();
  /** Ids of the assets the project really has; null until they have been listed. */
  const [knownAssetIds, setKnownAssetIds] = useState<Set<string> | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string | null>(null);
  const projectIdRef = useRef<string | null>(projectId);
  projectIdRef.current = projectId;

  const panelRef = useRef<HTMLDivElement>(null);
  const { shouldRender, animationState } = useDelayedUnmount(locationDatabaseOpen, 250);
  useSwipeDismiss(panelRef, { direction: 'right', onDismiss: toggleLocationDatabase, enabled: shouldRender && !isWide });
  const narrowPanel = useNarrowPanel(panelRef, shouldRender, SIDE_BY_SIDE_MIN_WIDTH);
  const sideBySide = isWide || !narrowPanel;
  const doc = useEditorDoc(editor, shouldRender);
  const briefs = useMemo(() => (doc ? collectSceneBriefs(doc) : []), [doc]);

  // Load locations when the panel opens or the project changes.
  useEffect(() => {
    if (locationDatabaseOpen && projectId) void loadLocations(projectId, true);
  }, [locationDatabaseOpen, projectId, loadLocations]);

  useEffect(() => {
    if (loadError) showToast(loadError || t('locations.loadFailed'), 'error');
  }, [loadError, t]);

  // A location named in another panel.
  useEffect(() => {
    if (!profileFocus || profileFocus.panel !== 'locations') return;
    const loc = locationNamed(locations, profileFocus.name);
    if (!loc && !useLocationStore.getState().loaded) return; // wait for the list
    if (loc) {
      setSelectedId(loc.id);
      if (profileFocus.tab && (LOCATION_TABS as readonly string[]).includes(profileFocus.tab)) setTab(profileFocus.tab as LocationTab);
    }
    setProfileFocus(null);
  }, [profileFocus, locations, setProfileFocus]);

  const refreshAssets = useCallback(async () => {
    if (!projectId) return;
    try {
      const list = await api.listAssets(projectId);
      if (projectIdRef.current !== projectId) return;
      setAssets(list);
      setKnownAssetIds(new Set(list.map((a: { id: string }) => a.id)));
    } catch (err) {
      // Not fatal: the images still render from their ids, we just cannot
      // tell which of them were deleted from the project since.
      console.warn('[locations] could not list project assets:', err);
      if (projectIdRef.current === projectId) setKnownAssetIds(null);
    }
  }, [projectId, setAssets]);

  useEffect(() => {
    setKnownAssetIds(null);
    setPickerOpen(false);
    setLightbox(null);
    if (locationDatabaseOpen && projectId) void refreshAssets();
  }, [locationDatabaseOpen, projectId, refreshAssets]);

  const getAssetUrl = useCallback(
    (assetId: string) => (projectId ? api.getAssetUrl(projectId, assetId) : ''),
    [projectId],
  );

  /** A location's images, without any whose asset has since been deleted from the project. */
  const imageIdsOf = useCallback(
    (loc: LocationEntry): string[] => {
      const ids = loc.imageAssetIds || [];
      return knownAssetIds ? ids.filter((id) => knownAssetIds.has(id)) : ids;
    },
    [knownAssetIds],
  );

  /** Save part of a location; a failure is shown, and the field keeps what was stored. */
  const save = useCallback(async (locId: string, patch: Partial<LocationEntry>): Promise<boolean> => {
    if (!projectId) return false;
    try {
      await updateLocation(projectId, locId, patch);
      return true;
    } catch (err) {
      console.error('[locations] could not save', patch, err);
      if (!alreadyReported(err)) showToast(err instanceof Error ? err.message : t('locations.saveFailed'), 'error');
      return false;
    }
  }, [projectId, updateLocation, t]);

  /** Change a location's image list from what it holds right now. */
  const changeImages = useCallback((locId: string, change: (ids: string[]) => string[]) => {
    const loc = useLocationStore.getState().locations.find((l) => l.id === locId);
    if (!loc) return;
    void save(locId, { imageAssetIds: change(imageIdsOf(loc)) });
  }, [save, imageIdsOf]);

  const changeLooks = useCallback((locId: string, change: (looks: LocationLook[]) => LocationLook[]) => {
    const loc = useLocationStore.getState().locations.find((l) => l.id === locId);
    if (!loc) return;
    void save(locId, { looks: change(loc.looks) });
  }, [save]);

  const handleUploadImage = useCallback(async (locId: string, file: File) => {
    if (!projectId) return;
    const loc = useLocationStore.getState().locations.find((l) => l.id === locId);
    if (!loc) return;
    // The picker is asked for images only, but not every platform's picker
    // honours that. A type the browser could not name is let through.
    if (file.type && !file.type.startsWith('image/')) {
      showToast(t('characters.imageUploadFailed', { message: file.name }), 'error');
      return;
    }
    setUploading(true);
    try {
      const data = await api.uploadAsset(projectId, file, [`location:${loc.name}`]);
      const assetId: string | undefined = data?.id || data?.asset?.id;
      if (!assetId) throw new Error(t('characters.unknownError'));
      // Known before it is attached, or the new image would be filtered out
      // as "deleted from the project" until the next listing.
      setKnownAssetIds((prev) => (prev ? new Set(prev).add(assetId) : prev));
      const now = useLocationStore.getState().locations.find((l) => l.id === locId);
      await updateLocation(projectId, locId, {
        imageAssetIds: [...(now ? imageIdsOf(now) : []).filter((id) => id !== assetId), assetId],
      });
      showToast(t('characters.imageUploaded'), 'success');
      void refreshAssets();
    } catch (err) {
      if (!alreadyReported(err)) {
        showToast(
          t('characters.imageUploadFailed', { message: err instanceof Error ? err.message : t('characters.unknownError') }),
          'error',
        );
      }
    } finally {
      setUploading(false);
    }
  }, [projectId, updateLocation, imageIdsOf, refreshAssets, t]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const locId = uploadTargetRef.current;
    // Cleared so choosing the same file again still raises a change event.
    e.target.value = '';
    if (file && locId) void handleUploadImage(locId, file);
  }, [handleUploadImage]);

  // Scenes set at each location, by record id — by its name or any alias.
  const scenesByLocation = useMemo(() => {
    const out = new Map<string, SceneBrief[]>();
    for (const scene of briefs) {
      const loc = scene.location ? locationNamed(locations, scene.location) : null;
      if (!loc) continue;
      if (!out.has(loc.id)) out.set(loc.id, []);
      out.get(loc.id)!.push(scene);
    }
    return out;
  }, [briefs, locations]);

  const discover = useCallback(async () => {
    if (!projectId) return;
    try {
      const n = await discoverLocations(projectId);
      showToast(n > 0 ? t('locations.discovered', { count: n }) : t('locations.noneFound'), 'success');
    } catch (err) {
      if (!alreadyReported(err)) showToast(err instanceof Error ? err.message : t('locations.discoveryFailed'), 'error');
    }
  }, [projectId, discoverLocations, t]);

  const create = useCallback(async (name: string) => {
    if (!projectId || !normalizeLocationName(name)) return;
    try {
      const loc = await createLocation(projectId, { name });
      setSelectedId(loc.id);
      setTab('details');
      setCreating(null);
    } catch (err) {
      if (!alreadyReported(err)) showToast(err instanceof Error ? err.message : t('locations.saveFailed'), 'error');
    }
  }, [projectId, createLocation, t]);

  const handleDelete = useCallback(async (loc: LocationEntry) => {
    if (!projectId) return;
    if (!window.confirm(t('locations.confirmDelete', { name: loc.name }))) return;
    try {
      await removeLocation(projectId, loc.id);
      if (selectedId === loc.id) setSelectedId(null);
      showToast(t('locations.deleted'), 'success');
    } catch (err) {
      if (!alreadyReported(err)) showToast(err instanceof Error ? err.message : t('locations.deleteFailed'), 'error');
    }
  }, [projectId, removeLocation, selectedId, t]);

  const handleRenameInHeadings = useCallback((oldName: string, newName: string): number => {
    if (!editor) return 0;
    const canonical = normalizeLocationName(newName);
    if (!canonical || canonical === oldName) return 0;
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
      if (parseLocationFromHeading(text) !== oldName) return true;
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
    if (skippedBroken > 0) showToast(t('locations.skippedHeadings', { count: skippedBroken }), 'info');
    return changed;
  }, [editor, t]);

  const applyRename = useCallback(async (loc: LocationEntry) => {
    if (!renaming) return;
    const canonical = normalizeLocationName(renaming.name);
    if (!canonical || canonical === loc.name) { setRenaming(null); return; }
    const oldName = loc.name;
    if (!(await save(loc.id, { name: canonical }))) return;
    if (renaming.headings) {
      const n = handleRenameInHeadings(oldName, canonical);
      if (n > 0) showToast(t('locations.renamedHeadings', { count: n }), 'success');
    } else {
      showToast(t('locations.updated'), 'success');
    }
    setRenaming(null);
  }, [renaming, save, handleRenameInHeadings, t]);

  const writeScene = useCallback((pos: number, change: Parameters<typeof writeSceneDetails>[2]) => {
    try {
      writeSceneDetails(editor, pos, change);
    } catch (err) {
      console.error('[locations] could not save the scene', err);
      showToast(t('sceneDetails.saveFailed'), 'error');
    }
  }, [editor, t]);

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

  if (!shouldRender) return null;

  const panelClass = !isWide && animationState === 'entered' ? 'panel-open'
    : !isWide && animationState === 'exiting' ? 'panel-closing' : '';
  const close = () => { setIsWide(false); toggleLocationDatabase(); };
  const selected = selectedId ? locations.find((l) => l.id === selectedId) ?? null : null;
  const shown = selected ?? (sideBySide ? filteredLocations[0] ?? null : null);
  const typeLabel = (type: LocationEntry['type']) => t(`locations.type.${type}`);

  const openScene = (scene: SceneBrief) => {
    goToPosition(editor, scene.pos + 1);
    jumpToPanel('scene-details', 'location-db');
  };
  const openCharacter = (name: string) => {
    setProfileFocus({ panel: 'characters', name, tab: 'scenes' });
    jumpToPanel('characters', 'location-db');
  };

  // ── The list ──

  const list = (
    <div className="sp-master">
      <div className="sp-tools">
        <input
          type="search"
          className="sp-input"
          style={{ flex: 1, minWidth: 120, width: 'auto' }}
          placeholder={t('locations.searchPlaceholder')}
          aria-label={t('locations.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="sp-btn" onClick={() => void discover()} disabled={loading || !projectId} title={t('locations.discoverTitle')}>
          {loading ? t('locations.scanning') : t('locations.discover')}
        </button>
        <button type="button" className="sp-btn sp-btn-primary" disabled={!projectId} onClick={() => setCreating('')} title={t('locations.newTitle')}>
          {t('locations.new')}
        </button>
      </div>
      {creating !== null && (
        <form className="sp-inline-form sp-tools" style={{ paddingTop: 0 }} onSubmit={(e) => { e.preventDefault(); void create(creating); }}>
          <input
            className="sp-input"
            autoFocus
            value={creating}
            placeholder={t('locations.newPlaceholder')}
            aria-label={t('locations.newTitle')}
            onChange={(e) => setCreating(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setCreating(null); }}
          />
          <button type="submit" className="sp-btn sp-btn-primary" disabled={!normalizeLocationName(creating)}>{t('common:add')}</button>
          <button type="button" className="sp-btn" onClick={() => setCreating(null)}>{t('common:cancel')}</button>
        </form>
      )}
      <div className="sp-list">
        {loading && locations.length === 0 ? (
          <div className="sp-empty">{t('common:loading')}</div>
        ) : filteredLocations.length === 0 ? (
          <div className="sp-empty">{locations.length === 0 ? t('locations.emptyNone') : t('locations.emptyNoMatch')}</div>
        ) : filteredLocations.map((loc) => {
          const [thumbId] = imageIdsOf(loc);
          const count = scenesByLocation.get(loc.id)?.length ?? 0;
          return (
            <button
              key={loc.id}
              type="button"
              className={`sp-row${shown?.id === loc.id ? ' current' : ''}`}
              onClick={() => setSelectedId(loc.id)}
            >
              {thumbId ? <img className="sp-row-thumb" src={getAssetUrl(thumbId)} alt="" loading="lazy" /> : <span className="sp-row-thumb empty" aria-hidden="true" />}
              <span className="sp-row-main">
                <span className="sp-row-name">{loc.name}<span className={`sp-type sp-type-${loc.type}`}>{typeLabel(loc.type)}</span></span>
                <span className="sp-row-sub">{loc.address || t('locations.noAddress')}</span>
                {loc.tags.length > 0 && <span className="sp-chips">{loc.tags.map((tag) => <span key={tag} className="sp-chip">{tag}</span>)}</span>}
              </span>
              <span className="sp-chip" title={t('locations.scenesSetHere')}>{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  // ── One location ──

  const renderDetails = (loc: LocationEntry) => {
    const imageIds = imageIdsOf(loc);
    const scenes = scenesByLocation.get(loc.id) ?? [];
    return (
      <>
        <div className="sp-field location-db-images">
          <label className="sp-label">{t('locations.images')}</label>
          {imageIds.length > 0 ? (
            <ReferenceImageGallery
              imageIds={imageIds}
              name={loc.name}
              getUrl={getAssetUrl}
              onOpen={(assetId) => setLightbox({ url: getAssetUrl(assetId), name: loc.name })}
              onSetPrimary={(assetId) => changeImages(loc.id, (ids) => [assetId, ...ids.filter((id) => id !== assetId)])}
              onRemove={(assetId) => changeImages(loc.id, (ids) => ids.filter((id) => id !== assetId))}
            />
          ) : (
            <div className="location-db-images-empty">{t('locations.noImages')}</div>
          )}
          <div className="char-profile-image-actions">
            <button type="button" className="char-profile-img-btn" disabled={uploading} title={t('locations.uploadImageTitle')}
              onClick={() => { uploadTargetRef.current = loc.id; fileInputRef.current?.click(); }}>
              {uploading ? t('characters.uploading') : t('characters.uploadImage')}
            </button>
            <button type="button" className="char-profile-img-btn" title={t('characters.fromAssetsTitle')}
              onClick={() => { setPickerOpen(true); void refreshAssets(); }}>
              {t('characters.fromAssets')}
            </button>
          </div>
        </div>
        <div className="sp-field">
          <label className="sp-label" htmlFor={`loc-desc-${loc.id}`}>{t('locations.description')}</label>
          <DraftText id={`loc-desc-${loc.id}`} multiline value={loc.description} placeholder={t('locations.descriptionPlaceholder')}
            onCommit={(v) => void save(loc.id, { description: v })} />
        </div>
        <div className="sp-cols2">
          <div className="sp-field">
            <label className="sp-label" htmlFor={`loc-full-${loc.id}`}>{t('locations.fullName')}</label>
            <DraftText id={`loc-full-${loc.id}`} value={loc.fullName} placeholder={t('locations.fullNamePlaceholder')}
              onCommit={(v) => void save(loc.id, { fullName: v })} />
          </div>
          <div className="sp-field">
            <span className="sp-label">{t('locations.typeLabel')}</span>
            <div className="sp-chips" role="radiogroup" aria-label={t('locations.typeLabel')}>
              {TYPES.map((type) => (
                <button key={type} type="button" role="radio" aria-checked={loc.type === type}
                  className={`sp-btn${loc.type === type ? ' sp-btn-primary' : ''}`} onClick={() => void save(loc.id, { type })}>
                  {typeLabel(type)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="sp-field">
          <div className="sp-sec">{t('locations.looks')} <span className="sp-sec-count">{loc.looks.length || ''}</span><small>{t('locations.looksHelp')}</small></div>
          <div className="sp-owned">
            {loc.looks.length === 0 && <div className="sp-note">{t('locations.noLooks')}</div>}
            {loc.looks.map((look) => {
              const used = scenes.filter((s) => lookForScene(loc.looks, s.details.lookId, s.timeOfDay)?.id === look.id).length;
              return (
                <div key={look.id} className="sp-owned-row">
                  <ImageSlot
                    small
                    projectId={projectId ?? ''}
                    assetId={look.imageAssetId}
                    name={`${loc.name} · ${look.name}`}
                    uploadTag={`location:${loc.name}`}
                    onChange={(assetId) => changeLooks(loc.id, (l) => l.map((x) => (x.id === look.id ? { ...x, imageAssetId: assetId } : x)))}
                  />
                  <DraftText value={look.name} aria-label={t('locations.lookName')}
                    onCommit={(v) => { if (v.trim()) changeLooks(loc.id, (l) => l.map((x) => (x.id === look.id ? { ...x, name: v.trim() } : x))); }} />
                  <span className="sp-note" style={{ whiteSpace: 'nowrap' }}>{t('characters.scenesShort', { count: used })}</span>
                  <button type="button" className="sp-icon-btn" onClick={() => changeLooks(loc.id, (l) => l.filter((x) => x.id !== look.id))}
                    title={t('locations.removeLook', { look: look.name })} aria-label={t('locations.removeLook', { look: look.name })}>&times;</button>
                </div>
              );
            })}
            <form className="sp-inline-form" onSubmit={(e) => {
              e.preventDefault();
              const name = newLook.trim();
              if (!name) return;
              changeLooks(loc.id, (l) => [...l, { id: newLookId(), name, imageAssetId: null }]);
              setNewLook('');
            }}>
              <input className="sp-input" value={newLook} placeholder={t('locations.newLookPlaceholder')} aria-label={t('locations.addLook')}
                onChange={(e) => setNewLook(e.target.value)} />
              <button type="submit" className="sp-btn" disabled={!newLook.trim()}>{t('locations.addLook')}</button>
            </form>
          </div>
        </div>
        <div className="sp-cols2">
          <div className="sp-field">
            <span className="sp-label">{t('locations.aliases')}</span>
            <div className="sp-chips">
              {loc.aliases.map((a) => (
                <span key={a} className="sp-chip">{a}
                  <button type="button" aria-label={t('locations.removeAlias', { alias: a })} title={t('locations.removeAlias', { alias: a })}
                    onClick={() => void save(loc.id, { aliases: loc.aliases.filter((x) => x !== a) })}>&times;</button>
                </span>
              ))}
              {loc.aliases.length === 0 && <span className="sp-note">{t('locations.noAliases')}</span>}
            </div>
            <form className="sp-inline-form" onSubmit={(e) => {
              e.preventDefault();
              const alias = normalizeLocationName(newAlias);
              if (!alias || alias === loc.name || loc.aliases.includes(alias)) { setNewAlias(''); return; }
              void save(loc.id, { aliases: [...loc.aliases, alias] });
              setNewAlias('');
            }}>
              <input className="sp-input" value={newAlias} placeholder={t('locations.aliasPlaceholder')} aria-label={t('locations.addAlias')}
                onChange={(e) => setNewAlias(e.target.value)} />
              <button type="submit" className="sp-btn" disabled={!newAlias.trim()} title={t('locations.addAliasTitle')}>{t('locations.addAlias')}</button>
            </form>
          </div>
          <div className="sp-field">
            <span className="sp-label">{t('locations.tags')}</span>
            <div className="sp-chips">
              {loc.tags.map((tag) => (
                <span key={tag} className="sp-chip">{tag}
                  <button type="button" aria-label={t('locations.removeTag', { tag })} title={t('locations.removeTag', { tag })}
                    onClick={() => void save(loc.id, { tags: loc.tags.filter((x) => x !== tag) })}>&times;</button>
                </span>
              ))}
              {loc.tags.length === 0 && <span className="sp-note">{t('locations.noTags')}</span>}
            </div>
            <form className="sp-inline-form" onSubmit={(e) => {
              e.preventDefault();
              const tag = newTag.trim();
              if (!tag || loc.tags.includes(tag)) { setNewTag(''); return; }
              void save(loc.id, { tags: [...loc.tags, tag] });
              setNewTag('');
            }}>
              <input className="sp-input" value={newTag} placeholder={t('locations.tagPlaceholder')} aria-label={t('locations.addTag')}
                onChange={(e) => setNewTag(e.target.value)} />
              <button type="submit" className="sp-btn" disabled={!newTag.trim()}>{t('locations.addTag')}</button>
            </form>
          </div>
        </div>
      </>
    );
  };

  const renderProduction = (loc: LocationEntry) => (
    <>
      <div className="sp-cols2">
        <div className="sp-field">
          <label className="sp-label" htmlFor={`loc-addr-${loc.id}`}>{t('locations.address')}</label>
          <DraftText id={`loc-addr-${loc.id}`} value={loc.address} onCommit={(v) => void save(loc.id, { address: v })} />
        </div>
        <div className="sp-field">
          <label className="sp-label" htmlFor={`loc-contact-${loc.id}`}>{t('locations.contact')}</label>
          <DraftText id={`loc-contact-${loc.id}`} value={loc.contact} onCommit={(v) => void save(loc.id, { contact: v })} />
        </div>
      </div>
      <div className="sp-field">
        <label className="sp-label" htmlFor={`loc-avail-${loc.id}`}>{t('locations.availability')}</label>
        <DraftText id={`loc-avail-${loc.id}`} value={loc.availability} onCommit={(v) => void save(loc.id, { availability: v })} />
      </div>
      <div className="sp-field">
        <label className="sp-label" htmlFor={`loc-notes-${loc.id}`}>{t('locations.notes')}</label>
        <DraftText id={`loc-notes-${loc.id}`} multiline rows={5} value={loc.notes} onCommit={(v) => void save(loc.id, { notes: v })} />
      </div>
    </>
  );

  const renderScenes = (loc: LocationEntry) => {
    const scenes = scenesByLocation.get(loc.id) ?? [];
    if (!scenes.length) return <div className="sp-note">{t('locations.noScenes')}</div>;
    const lookSelect = (s: SceneBrief) => {
      const auto = lookForScene(loc.looks, null, s.timeOfDay);
      return (
        <Select
          className="sp-select"
          aria-label={t('locations.lookInScene', { n: s.number ?? s.index + 1 })}
          value={s.details.lookId && loc.looks.some((l) => l.id === s.details.lookId) ? s.details.lookId : ''}
          onChange={(e) => writeScene(s.pos, (d) => ({ ...d, lookId: e.target.value || null }))}
        >
          <option value="">{auto ? t('sceneDetails.lookAuto', { look: auto.name }) : t('sceneDetails.lookNone')}</option>
          {loc.looks.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      );
    };
    const settingInput = (s: SceneBrief) => (
      <DraftText
        value={s.details.setting}
        placeholder={t('locations.settingPlaceholder')}
        aria-label={t('locations.settingInScene', { n: s.number ?? s.index + 1 })}
        onCommit={(v) => writeScene(s.pos, (d) => ({ ...d, setting: v }))}
      />
    );
    const who = (s: SceneBrief) => (s.cast.length ? (
      <span className="sp-stack" style={{ gap: 2 }}>
        {s.cast.map((m) => {
          const owned = profiles.find((p) => p.name === m.name)?.costumes ?? [];
          const worn = costumesIn(s.details, m.name).map((w) => owned.find((c) => c.id === w.costumeId)?.name).filter(Boolean);
          return (
            <span key={m.name}>
              <button type="button" className="sp-link" onClick={() => openCharacter(m.name)}>{m.name}</button>{' '}
              <span className="sp-note">{worn.length ? worn.join(t('locations.thenJoin')) : t('locations.noCostumeSet')}</span>
            </span>
          );
        })}
      </span>
    ) : <span className="sp-note">{t('characters.alone')}</span>);

    if (sideBySide) {
      return (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>{t('characters.col.number')}</th><th>{t('characters.col.scene')}</th><th>{t('sceneDetails.look')}</th>
                <th>{t('sceneDetails.setting')}</th><th>{t('locations.whoIsHere')}</th>
              </tr>
            </thead>
            <tbody>
              {scenes.map((s) => (
                <tr key={s.pos}>
                  <td className="sp-note">{s.number ?? s.index + 1}</td>
                  <td><button type="button" className="sp-link" onClick={() => openScene(s)}>{s.heading || t('sceneDetails.untitled')}</button></td>
                  <td style={{ minWidth: 110 }}>{lookSelect(s)}</td>
                  <td style={{ minWidth: 160 }}>{settingInput(s)}</td>
                  <td>{who(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return (
      <div className="sp-stack" style={{ gap: 8 }}>
        {scenes.map((s) => (
          <div key={s.pos} className="sp-scard">
            <div className="sp-scard-head">
              <span className="sp-scene-num" style={s.color ? { background: s.color } : undefined}>{s.number ?? s.index + 1}</span>
              <button type="button" className="sp-link" onClick={() => openScene(s)}>{s.heading || t('sceneDetails.untitled')}</button>
            </div>
            <dl className="sp-kv">
              <dt>{t('sceneDetails.look')}</dt><dd>{lookSelect(s)}</dd>
              <dt>{t('locations.settingShort')}</dt><dd>{settingInput(s)}</dd>
              <dt>{t('locations.whoShort')}</dt><dd>{who(s)}</dd>
            </dl>
          </div>
        ))}
      </div>
    );
  };

  const detail = (loc: LocationEntry) => {
    const count = scenesByLocation.get(loc.id)?.length ?? 0;
    return (
      <div className="sp-detail">
        <div className="sp-head">
          {!sideBySide && (
            <button type="button" className="sp-icon-btn" onClick={() => setSelectedId(null)} title={t('locations.backToList')} aria-label={t('locations.backToList')}>&#8249;</button>
          )}
          <h2 className="sp-title sp-title-record">{loc.name}</h2>
          <span className={`sp-type sp-type-${loc.type}`}>{typeLabel(loc.type)}</span>
          <span className="sp-grow" />
          <button type="button" className="sp-btn" onClick={() => setRenaming({ name: loc.name, headings: true })}>{t('locations.rename')}</button>
          <button type="button" className="sp-btn sp-btn-danger" onClick={() => void handleDelete(loc)}>{t('common:delete')}</button>
          {!sideBySide && (
            <>
              <button type="button" className="sp-icon-btn sp-wide-btn" onClick={() => setIsWide(true)} title={t('storyPanels.wideView')} aria-label={t('storyPanels.wideView')}>&#x26F6;</button>
              <button type="button" className="sp-icon-btn" onClick={close} title={t('common:close')} aria-label={t('common:close')}>&times;</button>
            </>
          )}
        </div>
        {renaming && (
          <form className="sp-tools sp-inline-form" style={{ flexWrap: 'wrap', borderBottom: '1px solid var(--fd-border)' }}
            onSubmit={(e) => { e.preventDefault(); void applyRename(loc); }}>
            <input className="sp-input" autoFocus value={renaming.name} aria-label={t('locations.name')}
              onChange={(e) => setRenaming({ ...renaming, name: e.target.value.toUpperCase() })}
              onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }} />
            <label className="sp-note" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={renaming.headings} onChange={(e) => setRenaming({ ...renaming, headings: e.target.checked })} />
              {t('locations.alsoRenameHeadings')}
            </label>
            <button type="submit" className="sp-btn sp-btn-primary" disabled={!normalizeLocationName(renaming.name)}>{t('common:save')}</button>
            <button type="button" className="sp-btn" onClick={() => setRenaming(null)}>{t('common:cancel')}</button>
          </form>
        )}
        <StoryPanelTabs
          value={tab}
          onChange={setTab}
          label={loc.name}
          tabs={[
            { id: 'details', label: t('locations.tab.details') },
            { id: 'production', label: t('locations.tab.production') },
            { id: 'scenes', label: <>{t('locations.tab.scenes')}<span className="sp-tab-count">{count}</span></> },
          ]}
        />
        <div className="sp-body">
          {tab === 'details' && renderDetails(loc)}
          {tab === 'production' && renderProduction(loc)}
          {tab === 'scenes' && renderScenes(loc)}
        </div>
      </div>
    );
  };

  const showRecordAlone = !sideBySide && !!selected;

  return (
    <div
      ref={panelRef}
      className={`location-database sp-panel${isWide ? ' sp-wide-overlay' : ''}${sideBySide ? '' : ' sp-narrow'} ${panelClass}`}
      style={isWide ? undefined : style}
    >
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileSelect} />

      {!showRecordAlone && (
        <StoryPanelHeader
          title={t('locations.title')}
          count={locations.length}
          wide={isWide}
          onToggleWide={() => setIsWide((w) => !w)}
          onClose={close}
        />
      )}

      {!projectId ? (
        <div className="sp-empty">{t('locations.noProject')}</div>
      ) : showRecordAlone && selected ? (
        detail(selected)
      ) : (
        <div className="sp-md">
          {list}
          {sideBySide && shown && detail(shown)}
        </div>
      )}

      {pickerOpen && shown && (
        <AssetImagePicker
          title={t('characters.selectImageFor', { name: shown.name })}
          assets={assets}
          linkedIds={imageIdsOf(shown)}
          emptyText={t('locations.noImageAssets')}
          getUrl={getAssetUrl}
          onPick={(assetId) => { setPickerOpen(false); changeImages(shown.id, (ids) => (ids.includes(assetId) ? ids : [...ids, assetId])); }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {lightbox && (
        <ImageLightbox url={lightbox.url} name={lightbox.name} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
};

export default LocationDatabase;
