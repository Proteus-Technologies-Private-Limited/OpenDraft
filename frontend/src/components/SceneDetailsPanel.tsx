/**
 * Scene Details: the scene the cursor is in, and everything in it — synopsis,
 * where it is set and how the place looks, who is there and what each of
 * them wears (in order, when a costume changes during the scene), what is
 * tagged in it, and its shots with the references a clip would need.
 *
 * Who speaks and where the scene is set are read from the script; costumes,
 * the look, a setting note and who is there without speaking are kept on the
 * scene heading (utils/sceneDetails). Costumes come from Character Profiles
 * and looks from Location Profiles, so each is described once.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, type CharacterProfile } from '../stores/editorStore';
import { useLocationStore } from '../stores/locationStore';
import { api, type LocationEntry } from '../services/api';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import { useEditorDoc, useEditorSelector } from '../hooks/useEditorTransactions';
import {
  SHOT_COSTUMES_ATTR,
  addPresentCharacter, addSceneCostume, collectSceneBriefs, costumesIn, moveSceneCostume,
  readShotCostumes, removePresentCharacter, removeSceneCostume, sceneAt,
  setSceneCostumeWhen, shotCostumeFor, shotShowsCharacter,
  type SceneBrief, type SceneDetails,
} from '../utils/sceneDetails';
import { lookForScene, locationNamed } from '../utils/locationData';
import { newCostumeId, type CharacterCostume } from '../utils/characterCostumes';
import { characterKey } from '../utils/nodeText';
import { goToPosition, useNarrowPanel, writeSceneDetails, jumpToPanel } from '../utils/storyPanels';
import { characterRoleLabel } from './RelationshipMap';
import { DraftText, StoryPanelHeader } from './StoryPanelParts';
import Select from './Select';
import { showToast } from './Toast';
import {
  pluginRegistry, resolvePluginText,
  type PluginSceneAction, type PluginSceneActionContext, type PluginSceneBrief, type PluginSceneImage, type PluginSceneShot,
} from '../plugins/registry';

interface Props {
  editor: Editor | null;
  projectId: string;
  style?: React.CSSProperties;
}

const NEW_COSTUME = '__new';

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2);
}

/** The scene, as a plugin is given it: every reference resolved to names and asset ids. */
function pluginBrief(
  scene: SceneBrief,
  profiles: readonly CharacterProfile[],
  location: LocationEntry | null,
): PluginSceneBrief {
  const profileOf = (name: string) => profiles.find((p) => p.name === name);
  const costumeOf = (name: string, id: string | null) => (id ? (profileOf(name)?.costumes ?? []).find((c) => c.id === id) ?? null : null);
  const image = (assetId: string | null | undefined, label: string): PluginSceneImage | null => (assetId ? { assetId, label } : null);
  const look = location ? lookForScene(location.looks, scene.details.lookId, scene.timeOfDay) : null;

  const shots: PluginSceneShot[] = scene.shots.map((shot, index) => ({
    index,
    text: shot.text,
    characters: scene.cast.filter((m) => shotShowsCharacter(shot.text, m.name)).map((m) => {
      const c = costumeOf(m.name, shotCostumeFor(costumesIn(scene.details, m.name), shot.costumes[m.name], index));
      return { name: m.name, costume: c ? { id: c.id, name: c.name, image: image(c.imageAssetId, c.name) } : null };
    }),
  }));

  return {
    index: scene.index,
    uid: scene.uid,
    heading: scene.heading,
    number: scene.number,
    synopsis: scene.synopsis,
    location: scene.location ? {
      name: location?.name ?? scene.location,
      type: location?.type ?? scene.locationType,
      description: location?.description ?? '',
      look: look ? { id: look.id, name: look.name, image: image(look.imageAssetId, look.name) } : null,
      setting: scene.details.setting,
      images: (location?.imageAssetIds ?? []).map((id) => ({ assetId: id, label: location?.name ?? scene.location })),
    } : null,
    cast: scene.cast.map((m) => {
      const prof = profileOf(m.name);
      return {
        name: m.name,
        lines: m.lines,
        images: (prof?.images ?? []).map((id) => ({ assetId: id, label: m.name })),
        costumes: costumesIn(scene.details, m.name).flatMap((ref) => {
          const c = costumeOf(m.name, ref.costumeId);
          return c ? [{ id: c.id, name: c.name, when: ref.when, image: image(c.imageAssetId, c.name) }] : [];
        }),
      };
    }),
    shots,
  };
}

/** A plugin's button and what it draws, for a scene or one shot. */
const PluginActions: React.FC<{ actions: PluginSceneAction[]; ctx: PluginSceneActionContext }> = ({ actions, ctx }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const shown = actions.filter((a) => {
    try { return a.available ? a.available(ctx) : true; } catch (err) {
      console.warn(`[scene details] add-on action ${a.id} could not say whether it applies`, err);
      return false;
    }
  });
  if (!shown.length) return null;
  return (
    <div className="sp-plugin-actions">
      {shown.map((a) => {
        const Preview = a.preview;
        return (
          <React.Fragment key={a.id}>
            {Preview && <Preview {...ctx} />}
            <button
              type="button"
              className="sp-btn sp-btn-primary"
              disabled={busy === a.id}
              onClick={async () => {
                setBusy(a.id);
                try {
                  await a.run(ctx);
                } catch (err) {
                  console.error(`[scene details] add-on action ${a.id} failed`, err);
                  showToast(err instanceof Error ? err.message : String(err), 'error');
                } finally {
                  setBusy(null);
                }
              }}
            >
              {resolvePluginText(a.labelKey, a.label)}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

const SceneDetailsPanel: React.FC<Props> = ({ editor, projectId, style }) => {
  const { t } = useTranslation(['story', 'common']);
  const sceneDetailsOpen = useEditorStore((s) => s.sceneDetailsOpen);
  const toggleSceneDetails = useEditorStore((s) => s.toggleSceneDetails);
  const profiles = useEditorStore((s) => s.characterProfiles);
  const scriptCharacters = useEditorStore((s) => s.characters);
  const upsertCharacterProfile = useEditorStore((s) => s.upsertCharacterProfile);
  const updateSceneSynopsis = useEditorStore((s) => s.updateSceneSynopsis);
  const tags = useEditorStore((s) => s.tags);
  const tagCategories = useEditorStore((s) => s.tagCategories);
  const setProfileFocus = useEditorStore((s) => s.setProfileFocus);
  const locations = useLocationStore((s) => s.locations);
  const loadLocations = useLocationStore((s) => s.load);
  const createLocation = useLocationStore((s) => s.create);

  const { shouldRender, animationState } = useDelayedUnmount(sceneDetailsOpen, 250);
  const panelRef = useRef<HTMLDivElement>(null);
  useSwipeDismiss(panelRef, { direction: 'right', onDismiss: toggleSceneDetails, enabled: shouldRender });
  const narrow = useNarrowPanel(panelRef, shouldRender, 640);

  const doc = useEditorDoc(editor, shouldRender);
  const head = useEditorSelector(shouldRender ? editor : null, (ed) => ed.state.selection.head, 0, 'the cursor', Object.is);
  const briefs = useMemo(() => (doc ? collectSceneBriefs(doc) : []), [doc]);
  const scene = sceneAt(briefs, head) ?? briefs[0] ?? null;

  useEffect(() => {
    if (sceneDetailsOpen && projectId) void loadLocations(projectId);
  }, [sceneDetailsOpen, projectId, loadLocations]);

  const [pluginRevision, setPluginRevision] = useState(0);
  useEffect(() => pluginRegistry.subscribe(() => setPluginRevision((n) => n + 1)), []);
  const actions = useMemo(() => {
    void pluginRevision;
    return pluginRegistry.getSceneActions();
  }, [pluginRevision]);

  // A costume being named before it is added: which character, in which scene.
  const [naming, setNaming] = useState<{ scene: number; character: string; name: string } | null>(null);

  const profileOf = useCallback((name: string) => profiles.find((p) => p.name === name), [profiles]);

  /** Rewrite a scene heading's details; a failure is logged and shown. */
  const writeDetails = useCallback((pos: number, change: (d: SceneDetails) => SceneDetails) => {
    try {
      writeSceneDetails(editor, pos, change);
    } catch (err) {
      console.error('[scene details] could not save the scene', err);
      showToast(t('sceneDetails.saveFailed'), 'error');
    }
  }, [editor, t]);

  const writeSynopsis = useCallback((brief: SceneBrief, synopsis: string) => {
    if (!editor || editor.isDestroyed) return;
    try {
      const node = editor.state.doc.nodeAt(brief.pos);
      if (!node || node.type.name !== 'sceneHeading') return;
      updateSceneSynopsis(`scene-${brief.index + 1}`, synopsis);
      const tr = editor.state.tr.setNodeAttribute(brief.pos, 'synopsis', synopsis);
      tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
    } catch (err) {
      console.error('[scene details] could not save the synopsis', err);
      showToast(t('sceneDetails.saveFailed'), 'error');
    }
  }, [editor, updateSceneSynopsis, t]);

  const writeShotCostume = useCallback((pos: number, character: string, costumeId: string) => {
    if (!editor || editor.isDestroyed) return;
    try {
      const node = editor.state.doc.nodeAt(pos);
      if (!node || node.type.name !== 'shot') return;
      const picked = { ...readShotCostumes(node.attrs[SHOT_COSTUMES_ATTR]), [characterKey(character)]: costumeId };
      const tr = editor.state.tr.setNodeAttribute(pos, SHOT_COSTUMES_ATTR, picked);
      tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
    } catch (err) {
      console.error('[scene details] could not save the shot', err);
      showToast(t('sceneDetails.saveFailed'), 'error');
    }
  }, [editor, t]);

  /** A new costume on the character's profile, worn in this scene. */
  const addNewCostume = useCallback((brief: SceneBrief, character: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    const costume: CharacterCostume = { id: newCostumeId(), name: clean, imageAssetId: null, notes: '' };
    upsertCharacterProfile(character, { costumes: [...(profileOf(character)?.costumes ?? []), costume] });
    writeDetails(brief.pos, (d) => addSceneCostume(d, character, costume.id));
  }, [upsertCharacterProfile, profileOf, writeDetails]);

  const openCharacter = useCallback((name: string) => {
    setProfileFocus({ panel: 'characters', name, tab: 'scenes' });
    jumpToPanel('characters', 'scene-details');
  }, [setProfileFocus]);

  const openLocation = useCallback((name: string) => {
    setProfileFocus({ panel: 'locations', name, tab: 'scenes' });
    jumpToPanel('location-db', 'scene-details');
  }, [setProfileFocus]);

  const addLocationRecord = useCallback(async (brief: SceneBrief) => {
    if (!projectId || !brief.location) return;
    try {
      await createLocation(projectId, { name: brief.location, type: brief.locationType });
      showToast(t('sceneDetails.locationAdded', { name: brief.location }), 'success');
    } catch (err) {
      const handled = !!err && typeof err === 'object' && (err as { handled?: unknown }).handled === true;
      if (!handled) showToast(err instanceof Error ? err.message : t('locations.saveFailed'), 'error');
    }
  }, [projectId, createLocation, t]);

  // Tags inside the scene, by category, from the marks in its text.
  const sceneTags = useMemo(() => {
    const out = new Map<string, Set<string>>();
    if (!doc || !scene) return out;
    const next = briefs[scene.index + 1];
    const end = next ? next.pos : doc.content.size;
    try {
      doc.nodesBetween(scene.pos, end, (node) => {
        for (const mark of node.marks) {
          if (mark.type.name !== 'productionTag') continue;
          const tag = tags.find((x) => x.id === mark.attrs.tagId);
          if (!tag) continue;
          const label = (tag.name || tag.text || '').trim();
          if (!label) continue;
          if (!out.has(tag.categoryId)) out.set(tag.categoryId, new Set());
          out.get(tag.categoryId)!.add(label);
        }
        return true;
      });
    } catch (err) {
      console.warn('[scene details] could not read the scene’s tags', err);
    }
    return out;
  }, [doc, scene, briefs, tags]);

  if (!shouldRender) return null;
  const panelClass = animationState === 'entered' ? 'panel-open' : animationState === 'exiting' ? 'panel-closing' : '';

  const close = () => toggleSceneDetails();
  const header = (
    <StoryPanelHeader
      title={t('sceneDetails.title')}
      count={scene ? t('sceneDetails.countOf', { n: scene.index + 1, total: briefs.length }) : undefined}
      extra={<span className="sp-note sp-follows">{t('sceneDetails.followsCursor')}</span>}
      onClose={close}
    />
  );

  if (!scene) {
    return (
      <div ref={panelRef} className={`scene-details-panel sp-panel ${panelClass}`} style={style}>
        {header}
        <div className="sp-body"><div className="sp-empty">{t('sceneDetails.noScenes')}</div></div>
      </div>
    );
  }

  const details = scene.details;
  const record = scene.location ? locationNamed(locations, scene.location) : null;
  const look = record ? lookForScene(record.looks, details.lookId, scene.timeOfDay) : null;
  const autoLook = record ? lookForScene(record.looks, null, scene.timeOfDay) : null;
  const locationThumb = look?.imageAssetId || record?.imageAssetIds[0] || null;
  const castNames = new Set(scene.cast.map((m) => m.name));
  const candidates = Array.from(new Set([...profiles.map((p) => p.name), ...scriptCharacters.map((c) => characterKey(c))]))
    .filter((n) => n && !castNames.has(n))
    .sort();
  const brief = pluginBrief(scene, profiles, record);
  const assetUrl = (id: string) => (projectId ? api.getAssetUrl(projectId, id) : '');
  const prev = briefs[scene.index - 1];
  const next = briefs[scene.index + 1];

  const castRow = (member: SceneBrief['cast'][number]) => {
    const prof = profileOf(member.name);
    const owned = prof?.costumes ?? [];
    const worn = costumesIn(details, member.name);
    const unused = owned.filter((c) => !worn.some((w) => w.costumeId === c.id));
    const isNaming = naming && naming.scene === scene.index && naming.character === member.name;
    const avatar = prof?.images?.[0];
    return (
      <div key={member.name} className="sp-cast">
        {avatar && projectId
          ? <img className="sp-avatar" src={assetUrl(avatar)} alt="" />
          : <span className="sp-avatar" style={{ background: prof?.color || '#6b7280' }} aria-hidden="true">{initials(member.name)}</span>}
        <div className="sp-cast-body">
          <div className="sp-cast-name-row">
            <button type="button" className="sp-link" onClick={() => openCharacter(member.name)}>{member.name}</button>
            <span className="sp-note">
              {[prof?.role ? characterRoleLabel(t, prof.role) : null,
                member.silent ? t('sceneDetails.doesNotSpeak') : t('sceneDetails.lines', { count: member.lines })].filter(Boolean).join(' · ')}
            </span>
            {member.silent && (
              <button
                type="button"
                className="sp-icon-btn sp-cast-remove"
                onClick={() => writeDetails(scene.pos, (d) => removePresentCharacter(d, member.name))}
                title={t('sceneDetails.removePresent', { name: member.name })}
                aria-label={t('sceneDetails.removePresent', { name: member.name })}
              >
                &times;
              </button>
            )}
          </div>
          {worn.map((ref, i) => {
            const costume = owned.find((c) => c.id === ref.costumeId);
            const label = costume?.name ?? t('sceneDetails.costumeGone');
            return (
              <div key={ref.costumeId} className={`sp-costume${costume ? '' : ' missing'}`}>
                <span className="sp-costume-order">{i + 1}</span>
                {costume?.imageAssetId && projectId && <img className="sp-costume-thumb" src={assetUrl(costume.imageAssetId)} alt="" />}
                <span className="sp-costume-name">{label}</span>
                {i > 0 ? (
                  <DraftText
                    className="sp-costume-when"
                    value={ref.when}
                    placeholder={t('sceneDetails.whenPlaceholder')}
                    aria-label={t('sceneDetails.whenLabel', { name: member.name, costume: label })}
                    onCommit={(when) => writeDetails(scene.pos, (d) => setSceneCostumeWhen(d, member.name, ref.costumeId, when))}
                  />
                ) : (
                  <span className="sp-note sp-costume-when">{t('sceneDetails.fromStart')}</span>
                )}
                {worn.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="sp-icon-btn"
                      disabled={i === 0}
                      onClick={() => writeDetails(scene.pos, (d) => moveSceneCostume(d, member.name, ref.costumeId, -1))}
                      title={t('sceneDetails.moveEarlier')}
                      aria-label={t('sceneDetails.moveEarlierNamed', { costume: label })}
                    >
                      &#8593;
                    </button>
                    <button
                      type="button"
                      className="sp-icon-btn"
                      disabled={i === worn.length - 1}
                      onClick={() => writeDetails(scene.pos, (d) => moveSceneCostume(d, member.name, ref.costumeId, 1))}
                      title={t('sceneDetails.moveLater')}
                      aria-label={t('sceneDetails.moveLaterNamed', { costume: label })}
                    >
                      &#8595;
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="sp-icon-btn"
                  onClick={() => writeDetails(scene.pos, (d) => removeSceneCostume(d, member.name, ref.costumeId))}
                  title={t('sceneDetails.removeCostume', { costume: label })}
                  aria-label={t('sceneDetails.removeCostume', { costume: label })}
                >
                  &times;
                </button>
              </div>
            );
          })}
          {isNaming ? (
            <form
              className="sp-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                addNewCostume(scene, member.name, naming.name);
                setNaming(null);
              }}
            >
              <input
                className="sp-input"
                autoFocus
                value={naming.name}
                placeholder={t('sceneDetails.newCostumePlaceholder')}
                aria-label={t('sceneDetails.newCostumeFor', { name: member.name })}
                onChange={(e) => setNaming({ ...naming, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Escape') setNaming(null); }}
              />
              <button type="submit" className="sp-btn sp-btn-primary" disabled={!naming.name.trim()}>{t('common:add')}</button>
              <button type="button" className="sp-btn" onClick={() => setNaming(null)}>{t('common:cancel')}</button>
            </form>
          ) : (
            <Select
              className="sp-select sp-select-dashed"
              value=""
              aria-label={t('sceneDetails.addCostumeFor', { name: member.name })}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                if (v === NEW_COSTUME) setNaming({ scene: scene.index, character: member.name, name: '' });
                else writeDetails(scene.pos, (d) => addSceneCostume(d, member.name, v));
              }}
            >
              <option value="">{worn.length ? t('sceneDetails.addAnotherCostume') : t('sceneDetails.chooseCostume')}</option>
              {unused.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={NEW_COSTUME}>{t('sceneDetails.newCostume')}</option>
            </Select>
          )}
        </div>
      </div>
    );
  };

  const shotCtx = (shot: PluginSceneShot): PluginSceneActionContext => ({ editor, projectId, scene: brief, shot });
  const shotActions = actions.filter((a) => a.target === 'shot');
  const sceneActions = actions.filter((a) => a.target === 'scene');

  const left = (
    <div className="sp-col">
      <div className="sp-scene-head">
        <button
          type="button"
          className="sp-icon-btn"
          disabled={!prev}
          onClick={() => prev && goToPosition(editor, prev.pos + 1)}
          title={t('sceneDetails.previousScene')}
          aria-label={t('sceneDetails.previousScene')}
        >
          &#8249;
        </button>
        <span className="sp-scene-num" style={scene.color ? { background: scene.color } : undefined}>{scene.number ?? scene.index + 1}</span>
        <button type="button" className="sp-scene-heading" onClick={() => goToPosition(editor, scene.pos + 1)} title={t('sceneDetails.goToScene')}>
          {scene.heading || t('sceneDetails.untitled')}
        </button>
        <button
          type="button"
          className="sp-icon-btn"
          disabled={!next}
          onClick={() => next && goToPosition(editor, next.pos + 1)}
          title={t('sceneDetails.nextScene')}
          aria-label={t('sceneDetails.nextScene')}
        >
          &#8250;
        </button>
      </div>

      <div className="sp-field">
        <label className="sp-label" htmlFor={`sd-syn-${scene.index}`}>{t('sceneDetails.synopsis')}</label>
        <DraftText
          id={`sd-syn-${scene.index}`}
          multiline
          value={scene.synopsis}
          placeholder={t('sceneDetails.synopsisPlaceholder')}
          onCommit={(v) => writeSynopsis(scene, v)}
        />
      </div>

      <div className="sp-sec">{t('sceneDetails.location')}</div>
      {scene.location ? (
        <div className="sp-card">
          <div className="sp-loc-row">
            {locationThumb && projectId
              ? <img className="sp-loc-thumb" src={assetUrl(locationThumb)} alt="" />
              : <span className="sp-loc-thumb empty" aria-hidden="true" />}
            <div className="sp-loc-main">
              {record
                ? <button type="button" className="sp-link" onClick={() => openLocation(record.name)}>{record.name}</button>
                : <span className="sp-strong">{scene.location}</span>}
              <div className="sp-chips">
                <span className={`sp-type sp-type-${record?.type ?? scene.locationType}`}>{t(`locations.type.${record?.type ?? scene.locationType}`)}</span>
                {scene.timeOfDay && <span className="sp-note">{scene.timeOfDay}</span>}
              </div>
            </div>
            {record && (
              <div className="sp-field sp-look-field">
                <label className="sp-label" htmlFor={`sd-look-${scene.index}`}>{t('sceneDetails.look')}</label>
                <Select
                  id={`sd-look-${scene.index}`}
                  className="sp-select"
                  value={details.lookId && record.looks.some((l) => l.id === details.lookId) ? details.lookId : ''}
                  onChange={(e) => writeDetails(scene.pos, (d) => ({ ...d, lookId: e.target.value || null }))}
                >
                  <option value="">{autoLook ? t('sceneDetails.lookAuto', { look: autoLook.name }) : t('sceneDetails.lookNone')}</option>
                  {record.looks.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </div>
            )}
          </div>
          {!record && projectId && (
            <div className="sp-banner">
              <span>{t('sceneDetails.locationNotRecorded')}</span>
              <span className="sp-grow" />
              <button type="button" className="sp-btn" onClick={() => void addLocationRecord(scene)}>{t('common:add')}</button>
            </div>
          )}
          {record && record.looks.length === 0 && (
            <div className="sp-note">
              {t('sceneDetails.noLooks')}{' '}
              <button type="button" className="sp-link" onClick={() => {
                setProfileFocus({ panel: 'locations', name: record.name, tab: 'details' });
                jumpToPanel('location-db', 'scene-details');
              }}>{t('sceneDetails.addLooks')}</button>
            </div>
          )}
          <div className="sp-field">
            <label className="sp-label" htmlFor={`sd-set-${scene.index}`}>{t('sceneDetails.setting')}</label>
            <DraftText
              id={`sd-set-${scene.index}`}
              value={details.setting}
              placeholder={t('sceneDetails.settingPlaceholder')}
              onCommit={(v) => writeDetails(scene.pos, (d) => ({ ...d, setting: v }))}
            />
          </div>
        </div>
      ) : (
        <div className="sp-note">{t('sceneDetails.noLocation')}</div>
      )}

      <div className="sp-sec">
        {t('sceneDetails.characters')} <span className="sp-sec-count">{scene.cast.length}</span>
        <small>{t('sceneDetails.costumesInOrder')}</small>
      </div>
      {scene.cast.length === 0 && <div className="sp-note">{t('sceneDetails.noCharacters')}</div>}
      <div>{scene.cast.map(castRow)}</div>
      {candidates.length > 0 && (
        <Select
          className="sp-select sp-select-dashed"
          value=""
          aria-label={t('sceneDetails.addPresent')}
          onChange={(e) => { if (e.target.value) writeDetails(scene.pos, (d) => addPresentCharacter(d, e.target.value)); }}
        >
          <option value="">{t('sceneDetails.addPresent')}</option>
          {candidates.map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
      )}

      <div className="sp-sec">
        {t('sceneDetails.tagged')}
        <small>
          <button type="button" className="sp-link" onClick={() => jumpToPanel('tags', 'scene-details')}>{t('tags.title')}</button>
        </small>
      </div>
      {sceneTags.size ? (
        <dl className="sp-kv">
          {[...sceneTags].map(([catId, names]) => {
            const cat = tagCategories.find((c) => c.id === catId);
            return (
              <React.Fragment key={catId}>
                <dt>{cat ? (cat.isBuiltIn ? t(`tags.category.${builtInKey(cat.id)}`, { defaultValue: cat.name }) : cat.name) : catId}</dt>
                <dd className="sp-chips">{[...names].map((n) => <span key={n} className="sp-chip">{n}</span>)}</dd>
              </React.Fragment>
            );
          })}
        </dl>
      ) : (
        <div className="sp-note">{t('sceneDetails.noTags')}</div>
      )}
    </div>
  );

  const right = (
    <div className="sp-col">
      <div className="sp-sec">
        {t('sceneDetails.shots')} <span className="sp-sec-count">{scene.shots.length}</span>
        {shotActions.length === 0 && <small>{t('sceneDetails.shotsHint')}</small>}
      </div>
      {scene.shots.length === 0 ? (
        <div className="sp-note">{t('sceneDetails.noShots')}</div>
      ) : (
        <div>
          {scene.shots.map((shot, i) => {
            const pShot = brief.shots[i];
            return (
              <div key={shot.pos} className="sp-shot">
                <div className="sp-shot-body">
                  <button type="button" className="sp-shot-text" onClick={() => goToPosition(editor, shot.pos + 1)}>
                    {i + 1} · {shot.text || t('sceneDetails.emptyShot')}
                  </button>
                  <div className="sp-chips">
                    {scene.location && (
                      <span className="sp-chip">{(record?.name ?? scene.location)}{look ? ` · ${look.name}` : ''}</span>
                    )}
                    {pShot.characters.map((c) => {
                      const worn = costumesIn(details, c.name);
                      const owned = profileOf(c.name)?.costumes ?? [];
                      if (worn.length > 1) {
                        const current = shotCostumeFor(worn, shot.costumes[c.name], i);
                        return (
                          <span key={c.name} className="sp-chip">
                            {c.name} ·{' '}
                            <Select
                              className="sp-chip-select"
                              value={current ?? ''}
                              aria-label={t('sceneDetails.shotCostume', { name: c.name, n: i + 1 })}
                              onChange={(e) => writeShotCostume(shot.pos, c.name, e.target.value)}
                            >
                              {worn.map((w) => (
                                <option key={w.costumeId} value={w.costumeId}>
                                  {owned.find((o) => o.id === w.costumeId)?.name ?? t('sceneDetails.costumeGone')}
                                </option>
                              ))}
                            </Select>
                          </span>
                        );
                      }
                      return <span key={c.name} className="sp-chip">{c.name}{c.costume ? ` · ${c.costume.name}` : ''}</span>;
                    })}
                  </div>
                  <PluginActions actions={shotActions} ctx={shotCtx(pShot)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {sceneActions.length > 0 && <PluginActions actions={sceneActions} ctx={{ editor, projectId, scene: brief }} />}
    </div>
  );

  return (
    <div ref={panelRef} className={`scene-details-panel sp-panel ${panelClass}`} style={style}>
      {header}
      <div className="sp-body">
        <div className={narrow ? 'sp-stack' : 'sp-two'}>
          {left}
          {right}
        </div>
      </div>
    </div>
  );
};

/** The translation key of a built-in tag category, by its id. */
function builtInKey(id: string): string {
  return id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export default SceneDetailsPanel;
