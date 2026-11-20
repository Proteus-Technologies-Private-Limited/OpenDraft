/**
 * Character Profiles: every character in the script, and one character at a
 * time on five tabs — Profile, Story, Voice, Relationships and Scenes.
 *
 * In a narrow panel the list and the character take turns; in a wide one
 * (or the wide view) they sit side by side. The Scenes tab is the cross-view
 * "one character, all scenes": where they are, with whom, and what they wear
 * in each, read from the script and from the costumes each scene notes
 * (utils/sceneDetails). The Relationship Map is the list's second tab.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ModalOverlay } from './ModalOverlay';
import type { Editor } from '@tiptap/react';
import DOMPurify from 'dompurify';
import { useTranslation } from 'react-i18next';
import { compareText } from '../i18n/format';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import { useEditorStore, type CharacterProfile, type CharacterRelationship } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { useLocationStore } from '../stores/locationStore';
import { characterKey, singleLine } from '../utils/nodeText';
import { useAssetStore } from '../stores/assetStore';
import { api } from '../services/api';
import { showToast } from './Toast';
import MiniRichText from './MiniRichText';
import { RelationshipMap, relTypeLabel, relDynamicLabel, characterRoleLabel } from './RelationshipMap';
import VoicePicker from './VoicePicker';
import { useTableReadStore } from '../stores/tableReadStore';
import Select from './Select';
import { AssetImagePicker, ImageLightbox, ReferenceImageGallery } from './ReferenceImages';
import { useEditorDoc } from '../hooks/useEditorTransactions';
import { collectSceneBriefs, costumesIn, type SceneBrief } from '../utils/sceneDetails';
import { newCostumeId, type CharacterCostume } from '../utils/characterCostumes';
import { lookForScene, locationNamed } from '../utils/locationData';
import { goToPosition, useNarrowPanel, jumpToPanel } from '../utils/storyPanels';
import { CompletenessRing, DraftText, ImageSlot, StoryPanelHeader, StoryPanelTabs, type CompletenessField } from './StoryPanelParts';

// Default colors for auto-assignment (VIBGYOR palette)
const DEFAULT_HIGHLIGHT_COLORS = [
  '#8b5cf6', '#4f46e5', '#2563eb', '#059669', '#eab308',
  '#f97316', '#ef4444', '#000000',
];
const SWATCHES = ['#8b5cf6', '#4f46e5', '#2563eb', '#059669', '#eab308', '#f97316', '#ef4444', '#000000', '#ffffff'];

// Character roles matching industry standard (Final Draft Character Navigator)
const CHARACTER_ROLES = ['', 'Lead', 'Supporting', 'Featured', 'Background', 'Day Player'];

type CharacterTab = 'profile' | 'story' | 'voice' | 'relationships' | 'scenes';
const CHARACTER_TABS: readonly CharacterTab[] = ['profile', 'story', 'voice', 'relationships', 'scenes'];

/** Strip HTML tags to get plain text (for collapsed preview and FDX export) */
function stripHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: [] }).replace(/\s+/g, ' ').trim();
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2);
}

const REL_TYPES = ['allies', 'rivals', 'family', 'romantic', 'mentor', 'antagonist', 'employer', 'friends'];
const REL_DYNAMICS = ['Stable', 'Evolving', 'Tense', 'One-sided', 'Supportive', 'Adversarial', 'Complex'];

/** Compact inline form for adding a relationship from within a character profile */
const InlineRelForm: React.FC<{
  characterName: string;
  allCharacters: string[];
  onSave: (rel: CharacterRelationship) => void;
  onCancel: () => void;
}> = ({ characterName, allCharacters, onSave, onCancel }) => {
  const { t } = useTranslation(['story', 'common']);
  const [otherChar, setOtherChar] = useState('');
  const [relType, setRelType] = useState('allies');
  const [dynamic, setDynamic] = useState('Stable');
  const [desc, setDesc] = useState('');

  const others = allCharacters.filter((c) => c !== characterName);

  return (
    <div className="char-profile-rel-form">
      <div className="char-profile-rel-form-row">
        <Select value={otherChar} onChange={(e) => setOtherChar(e.target.value)}>
          <option value="">{t('characters.selectCharacter')}</option>
          {others.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select value={relType} onChange={(e) => setRelType(e.target.value)}>
          {REL_TYPES.map((rt) => <option key={rt} value={rt}>{relTypeLabel(t, rt)}</option>)}
        </Select>
        <Select value={dynamic} onChange={(e) => setDynamic(e.target.value)}>
          {REL_DYNAMICS.map((d) => <option key={d} value={d}>{relDynamicLabel(t, d)}</option>)}
        </Select>
      </div>
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder={t('characters.placeholder.relationship')}
        rows={2}
        className="char-profile-rel-form-desc"
      />
      <div className="char-profile-rel-form-actions">
        <button className="char-profile-rel-form-btn" onClick={onCancel}>{t('common:cancel')}</button>
        <button
          className="char-profile-rel-form-btn char-profile-rel-form-btn-primary"
          disabled={!otherChar}
          onClick={() => onSave({
            id: crypto.randomUUID(),
            characterA: characterName,
            characterB: otherChar,
            type: relType,
            description: desc,
            dynamic,
          })}
        >
          {t('common:add')}
        </button>
      </div>
    </div>
  );
};

interface CharacterProfilesProps {
  editor: Editor | null;
  projectId: string;
  style?: React.CSSProperties;
}

interface CharStats { dialogueCount: number; sceneCount: number; scenes: SceneBrief[]; appearanceOrder: number }

const CharacterProfiles: React.FC<CharacterProfilesProps> = ({ editor, projectId, style }) => {
  const { t } = useTranslation(['story', 'common']);
  const {
    characters,
    characterProfiles,
    upsertCharacterProfile,
    deleteCharacterProfile,
    characterRelationships,
    upsertCharacterRelationship,
    deleteCharacterRelationship,
    characterProfilesOpen,
    toggleCharacterProfiles,
    selectedCharacter,
    setSelectedCharacter,
  } = useEditorStore();
  const profileFocus = useEditorStore((s) => s.profileFocus);
  const setProfileFocus = useEditorStore((s) => s.setProfileFocus);

  const currentScriptId = useProjectStore((s) => s.currentScriptId);
  const { assets, setAssets } = useAssetStore();
  const locations = useLocationStore((s) => s.locations);
  const loadLocations = useLocationStore((s) => s.load);

  const [listView, setListView] = useState<'profiles' | 'map'>('profiles');
  const [current, setCurrent] = useState<string | null>(null);
  const [tab, setTab] = useState<CharacterTab>('profile');
  const [costumeFilter, setCostumeFilter] = useState('');
  const [addRelFor, setAddRelFor] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showReferred, setShowReferred] = useState(false);
  const sortBy = useEditorStore((s) => s.characterSortBy);
  const setSortBy = useEditorStore((s) => s.setCharacterSortBy);
  const setRenamingCharacter = useEditorStore((s) => s.setRenamingCharacter);
  const [pendingRemoveChar, setPendingRemoveChar] = useState<string | null>(null);
  const [isWide, setIsWide] = useState(false);
  const [newCostumeName, setNewCostumeName] = useState('');

  // Image picker state
  const [imagePickerFor, setImagePickerFor] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const fetchAssets = useCallback(async () => {
    if (!projectId) return;
    try {
      const list = await api.listAssets(projectId);
      setAssets(list);
    } catch (err) {
      console.warn('Failed to fetch assets:', err);
    }
  }, [projectId, setAssets]);

  useEffect(() => {
    if (imagePickerFor && projectId) fetchAssets();
  }, [imagePickerFor, projectId, fetchAssets]);

  // Looks shown on the Scenes tab come from the project's locations.
  useEffect(() => {
    if (characterProfilesOpen && projectId) void loadLocations(projectId);
  }, [characterProfilesOpen, projectId, loadLocations]);

  /** Show one character, on a tab if one is named. */
  const openCharacter = useCallback((name: string, onTab?: string) => {
    setListView('profiles');
    setCurrent(characterKey(name) || name);
    setCostumeFilter('');
    if (onTab && (CHARACTER_TABS as readonly string[]).includes(onTab)) setTab(onTab as CharacterTab);
  }, []);

  // A cue clicked in the script, or a name clicked in another panel.
  useEffect(() => {
    if (!selectedCharacter) return;
    openCharacter(selectedCharacter);
    setSelectedCharacter(null);
  }, [selectedCharacter, setSelectedCharacter, openCharacter]);

  useEffect(() => {
    if (!profileFocus || profileFocus.panel !== 'characters') return;
    openCharacter(profileFocus.name, profileFocus.tab);
    setProfileFocus(null);
  }, [profileFocus, setProfileFocus, openCharacter]);

  // Auto-sync: ensure every detected character has a profile entry
  useEffect(() => {
    for (const name of characters) {
      const upper = name.toUpperCase();
      if (!characterProfiles.find((p) => p.name === upper)) {
        const colorIdx = characterProfiles.length % DEFAULT_HIGHLIGHT_COLORS.length;
        upsertCharacterProfile(upper, { color: DEFAULT_HIGHLIGHT_COLORS[colorIdx] });
      }
    }
  }, [characters, characterProfiles, upsertCharacterProfile]);

  /**
   * "Build from Script" — scan the screenplay to extract character info:
   * 1. Collect all character names from Character elements
   * 2. For each character, scan Action lines for their ALL-CAPS name to find
   *    introductory descriptions (e.g. "SARAH (30s, sharp eyes, worn jacket) enters")
   * 3. Try to extract age/gender hints from the description
   */
  const handleBuildFromScript = useCallback(() => {
    if (!editor) return;
    const doc = editor.state.doc;

    // Step 1: collect unique character names
    const names = new Set<string>();
    doc.descendants((node) => {
      if (node.type.name === 'character') {
        const base = characterKey(node.textContent);
        if (base) names.add(base);
      }
      return true;
    });

    // Step 2: for each name, find the first Action line that mentions them in ALL CAPS
    // Screenwriters introduce characters like: "SARAH CHEN (30s, sharp eyes) sits alone."
    const descriptions = new Map<string, string>();
    const ages = new Map<string, string>();

    for (const charName of names) {
      // Already has a description? Skip.
      const existing = characterProfiles.find((p) => p.name === charName);
      if (existing?.description) continue;

      let found = false;
      doc.descendants((node) => {
        if (found) return false;
        if (node.type.name !== 'action') return true;
        const text = node.textContent;
        // Look for the character name in ALL CAPS within the action line
        const idx = text.indexOf(charName);
        if (idx === -1) return true;

        // Check it's actually an ALL-CAPS word (not part of a lowercase word)
        const before = idx > 0 ? text[idx - 1] : ' ';
        const after = idx + charName.length < text.length ? text[idx + charName.length] : ' ';
        if (/[a-zA-Z]/.test(before) || /[a-z]/.test(after)) return true;

        // Extract the whole sentence containing the character name
        let sentStart = idx;
        while (sentStart > 0 && text[sentStart - 1] !== '.' && text[sentStart - 1] !== '\n') sentStart--;
        let sentEnd = idx + charName.length;
        while (sentEnd < text.length && text[sentEnd] !== '.' && text[sentEnd] !== '\n') sentEnd++;
        if (sentEnd < text.length && text[sentEnd] === '.') sentEnd++;

        const sentence = text.slice(sentStart, sentEnd).trim();
        if (sentence.length > 10) {
          descriptions.set(charName, sentence);

          // Try to extract age from parenthetical right after the name
          // e.g. "SARAH (30s, sharp)" or "MARCUS, 40s,"
          const afterName = text.slice(idx + charName.length, idx + charName.length + 60);
          const ageMatch = afterName.match(/\(?(\d{1,2}0?s?|\d{1,2})\)?[,\s]/);
          if (ageMatch) {
            ages.set(charName, ageMatch[1]);
          }
        }

        found = true;
        return false;
      });
    }

    // Step 3: remove orphaned profiles (characters no longer in script)
    for (const prof of characterProfiles) {
      if (!names.has(prof.name)) {
        deleteCharacterProfile(prof.name);
      }
    }

    // Step 4: apply to profiles
    let colorIdx = characterProfiles.length;
    for (const charName of names) {
      const existing = characterProfiles.find((p) => p.name === charName);
      const updates: Partial<Omit<CharacterProfile, 'name'>> = {};

      if (!existing) {
        updates.color = DEFAULT_HIGHLIGHT_COLORS[colorIdx % DEFAULT_HIGHLIGHT_COLORS.length];
        colorIdx++;
      }

      const desc = descriptions.get(charName);
      if (desc && !existing?.description) {
        updates.description = desc;
      }

      const age = ages.get(charName);
      if (age && !existing?.age) {
        updates.age = age;
      }

      if (Object.keys(updates).length > 0) {
        upsertCharacterProfile(charName, updates);
      }
    }
  }, [editor, characterProfiles, upsertCharacterProfile, deleteCharacterProfile]);

  const { shouldRender, animationState } = useDelayedUnmount(characterProfilesOpen, 250);
  // Its lists are read off the document, so a selection that moves needs no render.
  const doc = useEditorDoc(editor, shouldRender);
  const panelRef = useRef<HTMLDivElement>(null);
  useSwipeDismiss(panelRef, { direction: 'right', onDismiss: toggleCharacterProfiles, enabled: shouldRender && !isWide });
  const narrowPanel = useNarrowPanel(panelRef, shouldRender, 620);
  const sideBySide = isWide || !narrowPanel;

  const briefs = useMemo(() => (doc ? collectSceneBriefs(doc) : []), [doc]);

  // Per character: lines, scenes (speaking or noted as there), order of first appearance.
  const charStats = useMemo((): Map<string, CharStats> => {
    const stats = new Map<string, CharStats>();
    let order = 0;
    for (const scene of briefs) {
      for (const member of scene.cast) {
        let s = stats.get(member.name);
        if (!s) {
          s = { dialogueCount: 0, sceneCount: 0, scenes: [], appearanceOrder: order++ };
          stats.set(member.name, s);
        }
        s.dialogueCount += member.lines;
        s.sceneCount++;
        s.scenes.push(scene);
      }
    }
    return stats;
  }, [briefs]);

  /** Navigate to first appearance of a character in the script */
  const handleNavigateToCharacter = useCallback(
    (name: string) => {
      if (!editor) return;
      const upper = name.toUpperCase();
      let targetPos: number | null = null;

      editor.state.doc.descendants((node, pos) => {
        if (targetPos !== null) return false;
        if (node.type.name === 'character') {
          const base = characterKey(node.textContent);
          if (base === upper) {
            targetPos = pos + 1; // inside the node
            return false;
          }
        }
        return true;
      });

      if (targetPos !== null) goToPosition(editor, targetPos);
    },
    [editor],
  );

  /** Show a scene in the script, with Scene Details beside it. */
  const openScene = useCallback((scene: SceneBrief) => {
    goToPosition(editor, scene.pos + 1);
    jumpToPanel('scene-details', 'characters');
  }, [editor]);

  // Detect potential characters mentioned in action lines (ALL-CAPS words 2+ chars)
  // that are not yet in the character list — these may be non-speaking characters
  const unmatchedNames = useMemo(() => {
    if (!doc) return [];
    const known = new Set<string>();
    for (const c of characters) known.add(c.toUpperCase());
    for (const p of characterProfiles) known.add(p.name);

    // Common ALL-CAPS words to exclude (not character names)
    const EXCLUDE = new Set([
      'INT', 'EXT', 'DAY', 'NIGHT', 'CONTINUOUS', 'LATER', 'MORNING',
      'EVENING', 'DAWN', 'DUSK', 'NOON', 'AFTERNOON', 'FADE', 'CUT',
      'DISSOLVE', 'SMASH', 'TO', 'IN', 'OUT', 'THE', 'AND', 'BUT',
      'FOR', 'NOT', 'ALL', 'HER', 'HIS', 'SHE', 'HIM', 'THEY', 'ARE',
      'WAS', 'HAS', 'WITH', 'FROM', 'THAT', 'THIS', 'THEN', 'THAN',
      'BACK', 'OVER', 'CONT', "CONT'D", 'MORE', 'END', 'ACT', 'ANGLE',
      'CLOSE', 'WIDE', 'POV', 'FLASHBACK', 'INTERCUT', 'SUPER', 'TITLE',
      'SERIES', 'SHOTS', 'MONTAGE', 'BEGIN', 'RESUME', 'SAME', 'TIME',
      'MATCH', 'JUMP', 'FREEZE', 'FRAME', 'STOCK', 'SHOT', 'INSERT',
    ]);

    const found = new Set<string>();
    doc.descendants((node) => {
      if (node.type.name !== 'action') return true;
      const text = node.textContent;
      // Match sequences of 2+ uppercase words (character names are often multi-word)
      const regex = /\b([A-Z][A-Z.'\- ]{1,30}[A-Z])\b/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const candidate = match[1].trim();
        if (candidate.length < 2) continue;
        const words = candidate.split(/\s+/);
        if (words.every((w) => EXCLUDE.has(w.replace(/[.']/g, '')))) continue;
        if (known.has(candidate)) continue;
        found.add(candidate);
      }
      return true;
    });

    return Array.from(found).sort();
  }, [doc, characters, characterProfiles]);

  const handleAddUnmatched = useCallback(
    (name: string) => {
      const colorIdx = characterProfiles.length % DEFAULT_HIGHLIGHT_COLORS.length;
      upsertCharacterProfile(name, { color: DEFAULT_HIGHLIGHT_COLORS[colorIdx] });
    },
    [characterProfiles, upsertCharacterProfile],
  );

  // Characters that have a profile but are no longer detected in the script.
  // Scan the document directly so we don't depend on the store's `characters` timing.
  const scriptCharacterNames = useMemo(() => {
    const names = new Set<string>();
    if (!doc) return names;
    doc.descendants((node) => {
      if (node.type.name === 'character') {
        const base = characterKey(node.textContent);
        if (base) names.add(base);
      }
      return true;
    });
    return names;
  }, [doc]);

  const orphanedNames = useMemo(() => {
    return new Set(
      characterProfiles
        .filter((p) => !scriptCharacterNames.has(p.name))
        .map((p) => p.name),
    );
  }, [characterProfiles, scriptCharacterNames]);

  // All characters (from profiles + auto-detected), sorted by selected criteria
  const allCharacters = useMemo(() => {
    const nameSet = new Set<string>();
    for (const p of characterProfiles) nameSet.add(p.name);
    for (const c of characters) nameSet.add(c.toUpperCase());
    for (const name of scriptCharacterNames) nameSet.add(name);
    let list = Array.from(nameSet);

    if (searchQuery) {
      const q = searchQuery.toUpperCase();
      list = list.filter((n) => n.includes(q));
    }

    list.sort((a, b) => {
      const sa = charStats.get(a);
      const sb = charStats.get(b);
      switch (sortBy) {
        case 'name':
          return compareText(a, b);
        case 'importance':
          return ((sb?.sceneCount ?? 0) + (sb?.dialogueCount ?? 0))
               - ((sa?.sceneCount ?? 0) + (sa?.dialogueCount ?? 0));
        case 'scenes':
          return (sb?.sceneCount ?? 0) - (sa?.sceneCount ?? 0);
        case 'dialogues':
          return (sb?.dialogueCount ?? 0) - (sa?.dialogueCount ?? 0);
        case 'appearance':
          return (sa?.appearanceOrder ?? 999) - (sb?.appearanceOrder ?? 999);
        default:
          return 0;
      }
    });

    return list;
  }, [characterProfiles, characters, scriptCharacterNames, searchQuery, sortBy, charStats]);

  const getProfile = useCallback(
    (name: string): CharacterProfile => {
      const existing = characterProfiles.find((p) => p.name === name);
      if (existing) return existing;
      return { name, description: '', color: '', highlighted: false, gender: '', age: '', role: '', backstory: '', arc: '', speechPattern: '', vocabulary: '', verbalTics: '', sampleDialogue: '', images: [], costumes: [] };
    },
    [characterProfiles],
  );

  // Voices Table Read cast automatically, shown beside "Automatic".
  const tableReadCasting = useTableReadStore((s) => s.casting);

  /** Profile completeness: which fields are filled in. */
  const completenessFields = useCallback((profile: CharacterProfile): CompletenessField[] => [
    { label: t('characters.field.description'), filled: !!stripHtml(profile.description || '').trim() },
    { label: t('characters.field.gender'), filled: !!profile.gender },
    { label: t('characters.field.age'), filled: !!profile.age },
    { label: t('characters.field.role'), filled: !!profile.role },
    { label: t('characters.field.backstory'), filled: !!stripHtml(profile.backstory || '').trim() },
    { label: t('characters.field.arc'), filled: !!stripHtml(profile.arc || '').trim() },
    { label: t('characters.field.speechPattern'), filled: !!stripHtml(profile.speechPattern || '').trim() },
    { label: t('characters.field.vocabulary'), filled: !!stripHtml(profile.vocabulary || '').trim() },
    { label: t('characters.field.verbalTics'), filled: !!stripHtml(profile.verbalTics || '').trim() },
    { label: t('characters.field.image'), filled: (profile.images?.length || 0) > 0 },
  ], [t]);

  // Image helpers
  const getAssetUrl = useCallback((assetId: string) => api.getAssetUrl(projectId, assetId), [projectId]);

  const handleUploadImage = useCallback(async (charName: string, file: File) => {
    if (!projectId) return;
    setUploading(true);
    try {
      const data = await api.uploadAsset(projectId, file, [`character:${charName}`]);
      const assetId = data.id || data.asset?.id;
      if (assetId) {
        const profile = useEditorStore.getState().characterProfiles.find((p) => p.name === charName);
        const currentImages = profile?.images || [];
        upsertCharacterProfile(charName, { images: [...currentImages, assetId] });
      }
      await fetchAssets();
      showToast(t('characters.imageUploaded'), 'success');
    } catch (err) {
      showToast(t('characters.imageUploadFailed', { message: err instanceof Error ? err.message : t('characters.unknownError') }), 'error');
    } finally {
      setUploading(false);
    }
  }, [projectId, upsertCharacterProfile, fetchAssets, t]);

  const handleAssociateAsset = useCallback((charName: string, assetId: string) => {
    const profile = characterProfiles.find((p) => p.name === charName);
    const currentImages = profile?.images || [];
    if (!currentImages.includes(assetId)) {
      upsertCharacterProfile(charName, { images: [...currentImages, assetId] });
    }
    setImagePickerFor(null);
  }, [characterProfiles, upsertCharacterProfile]);

  const handleRemoveImage = useCallback((charName: string, assetId: string) => {
    const profile = characterProfiles.find((p) => p.name === charName);
    upsertCharacterProfile(charName, { images: (profile?.images || []).filter((id) => id !== assetId) });
  }, [characterProfiles, upsertCharacterProfile]);

  const handleSetPrimaryImage = useCallback((charName: string, assetId: string) => {
    const profile = characterProfiles.find((p) => p.name === charName);
    const filtered = (profile?.images || []).filter((id) => id !== assetId);
    upsertCharacterProfile(charName, { images: [assetId, ...filtered] });
  }, [characterProfiles, upsertCharacterProfile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const charName = uploadTargetRef.current;
    if (file && charName) void handleUploadImage(charName, file);
    e.target.value = '';
  }, [handleUploadImage]);

  const triggerUpload = useCallback((charName: string) => {
    uploadTargetRef.current = charName;
    fileInputRef.current?.click();
  }, []);

  /** Change one of a character's costumes, or the list of them. */
  const setCostumes = useCallback((charName: string, change: (list: CharacterCostume[]) => CharacterCostume[]) => {
    const profile = useEditorStore.getState().characterProfiles.find((p) => p.name === charName);
    upsertCharacterProfile(charName, { costumes: change(profile?.costumes ?? []) });
  }, [upsertCharacterProfile]);

  if (!shouldRender) return null;

  const panelClass = !isWide && animationState === 'entered'
    ? 'panel-open' : !isWide && animationState === 'exiting' ? 'panel-closing' : '';
  const close = () => { setIsWide(false); toggleCharacterProfiles(); };
  const currentName = current && allCharacters.concat(characterProfiles.map((p) => p.name)).includes(current) ? current : null;
  const shownName = currentName ?? (sideBySide && listView === 'profiles' ? allCharacters[0] ?? null : null);

  // ── The list ──

  const tabsBar = (
    <StoryPanelTabs
      value={listView}
      onChange={setListView}
      label={t('characters.title')}
      tabs={[{ id: 'profiles', label: t('characters.tabProfiles') }, { id: 'map', label: t('characters.tabMap') }]}
    />
  );

  const map = (
    <div className="sp-body">
      <RelationshipMap
        key={currentScriptId || 'no-script'}
        scriptId={currentScriptId || undefined}
        onSelectCharacter={(name) => openCharacter(name, 'relationships')}
      />
    </div>
  );

  const list = (
    <div className="sp-master">
      {tabsBar}
          <div className="sp-tools">
            <input
              type="search"
              className="sp-input"
              style={{ flex: 1, minWidth: 120, width: 'auto' }}
              placeholder={t('characters.placeholder.search')}
              aria-label={t('characters.placeholder.search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button type="button" className="sp-btn" onClick={handleBuildFromScript} title={t('characters.buildFromScriptTitle')}>
              {t('characters.buildFromScript')}
            </button>
          </div>
          <div className="sp-tools" style={{ paddingTop: 0 }}>
            <label className="sp-label" htmlFor="char-sort">{t('characters.sort.label')}</label>
            <Select id="char-sort" className="sp-select" style={{ flex: 1, width: 'auto' }} value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
              <option value="name">{t('characters.sort.name')}</option>
              <option value="importance">{t('characters.sort.importance')}</option>
              <option value="scenes">{t('characters.sort.scenes')}</option>
              <option value="dialogues">{t('characters.sort.dialogues')}</option>
              <option value="appearance">{t('characters.sort.appearance')}</option>
            </Select>
          </div>
          <div className="sp-list">
            {allCharacters.length === 0 ? (
              <div className="sp-empty">{searchQuery ? t('characters.noMatch') : t('characters.noneDetected')}</div>
            ) : allCharacters.map((name) => {
              const profile = getProfile(name);
              const stats = charStats.get(name);
              const image = profile.images?.[0];
              const plain = stripHtml(profile.description || '');
              const role = profile.role ? characterRoleLabel(t, profile.role) : t('characters.noRole');
              return (
                <button
                  key={name}
                  type="button"
                  data-char-name={name}
                  className={`sp-row${shownName === name ? ' current' : ''}${orphanedNames.has(name) ? ' orphan' : ''}`}
                  onClick={() => openCharacter(name)}
                >
                  {image && projectId
                    ? <img className="sp-avatar" src={getAssetUrl(image)} alt="" />
                    : <span className="sp-avatar" style={{ background: profile.color || '#999' }} aria-hidden="true">{initials(name)}</span>}
                  <span className="sp-row-main">
                    <span className="sp-row-name">{name}</span>
                    <span className="sp-row-sub">{plain || t('characters.noDescription')}</span>
                    <span className="sp-row-sub">
                      {stats
                        ? `${role} · ${t('characters.linesShort', { count: stats.dialogueCount })} · ${t('characters.scenesShort', { count: stats.sceneCount })}`
                        : `${role} · ${t('characters.notInScript')}`}
                    </span>
                  </span>
                  <CompletenessRing fields={completenessFields(profile)} />
                </button>
              );
            })}
          </div>
          {unmatchedNames.length > 0 && (
            <div className="sp-tools" style={{ borderTop: '1px solid var(--fd-border)' }}>
              <button type="button" className="sp-btn" style={{ width: '100%' }} onClick={() => setShowReferred(true)}>
                {t('characters.referredButton', { n: unmatchedNames.length })}
              </button>
            </div>
          )}
    </div>
  );

  // ── One character ──

  const renderProfileTab = (name: string, prof: CharacterProfile) => {
    const owned = prof.costumes ?? [];
    const scenesWith = (costumeId: string) => (charStats.get(name)?.scenes ?? [])
      .filter((s) => costumesIn(s.details, name).some((c) => c.costumeId === costumeId)).length;
    return (
      <>
        {projectId && (
          <div className="sp-field">
            <ReferenceImageGallery
              imageIds={prof.images || []}
              name={name}
              getUrl={getAssetUrl}
              onOpen={(id) => setLightboxImage({ url: getAssetUrl(id), name })}
              onSetPrimary={(id) => handleSetPrimaryImage(name, id)}
              onRemove={(id) => handleRemoveImage(name, id)}
            />
            <div className="char-profile-image-actions">
              <button className="char-profile-img-btn" onClick={() => triggerUpload(name)} disabled={uploading} title={t('characters.uploadImageTitle')}>
                {uploading ? t('characters.uploading') : t('characters.uploadImage')}
              </button>
              <button className="char-profile-img-btn" onClick={() => setImagePickerFor(name)} title={t('characters.fromAssetsTitle')}>
                {t('characters.fromAssets')}
              </button>
            </div>
          </div>
        )}
        <div className="sp-field">
          <label className="sp-label">{t('characters.field.description')}</label>
          <MiniRichText
            value={prof.description}
            onChange={(html) => upsertCharacterProfile(name, { description: html })}
            placeholder={t('characters.placeholder.description')}
            minHeight={60}
          />
        </div>
        <div className="sp-cols2" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr)' }}>
          <div className="sp-field">
            <label className="sp-label" htmlFor={`char-role-${name}`}>{t('characters.field.role')}</label>
            <Select id={`char-role-${name}`} className="sp-select" value={prof.role} onChange={(e) => upsertCharacterProfile(name, { role: e.target.value })}>
              {CHARACTER_ROLES.map((r) => <option key={r} value={r}>{r ? characterRoleLabel(t, r) : '—'}</option>)}
            </Select>
          </div>
          <div className="sp-field">
            <label className="sp-label" htmlFor={`char-gender-${name}`}>{t('characters.field.gender')}</label>
            <input id={`char-gender-${name}`} type="text" className="sp-input" value={prof.gender}
              onChange={(e) => upsertCharacterProfile(name, { gender: e.target.value })} placeholder={t('characters.placeholder.gender')} />
          </div>
          <div className="sp-field">
            <label className="sp-label" htmlFor={`char-age-${name}`}>{t('characters.field.age')}</label>
            <input id={`char-age-${name}`} type="text" className="sp-input" value={prof.age}
              onChange={(e) => upsertCharacterProfile(name, { age: e.target.value })} placeholder={t('characters.placeholder.age')} />
          </div>
        </div>

        <div className="sp-field">
          <div className="sp-sec">{t('characters.costumes')} <span className="sp-sec-count">{owned.length || ''}</span><small>{t('characters.costumesHelp')}</small></div>
          <div className="sp-owned">
            {owned.length === 0 && <div className="sp-note">{t('characters.noCostumes')}</div>}
            {owned.map((c) => (
              <div key={c.id} className="sp-owned-row">
                <ImageSlot
                  small
                  projectId={projectId}
                  assetId={c.imageAssetId}
                  name={`${name} · ${c.name}`}
                  uploadTag={`costume:${name}`}
                  onChange={(assetId) => setCostumes(name, (l) => l.map((x) => (x.id === c.id ? { ...x, imageAssetId: assetId } : x)))}
                />
                <DraftText
                  value={c.name}
                  aria-label={t('characters.costumeName')}
                  onCommit={(v) => { if (v.trim()) setCostumes(name, (l) => l.map((x) => (x.id === c.id ? { ...x, name: v.trim() } : x))); }}
                />
                <span className="sp-note" style={{ whiteSpace: 'nowrap' }}>{t('characters.scenesShort', { count: scenesWith(c.id) })}</span>
                <button
                  type="button"
                  className="sp-icon-btn"
                  onClick={() => setCostumes(name, (l) => l.filter((x) => x.id !== c.id))}
                  title={t('characters.removeCostume', { costume: c.name })}
                  aria-label={t('characters.removeCostume', { costume: c.name })}
                >
                  &times;
                </button>
              </div>
            ))}
            <form
              className="sp-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const clean = newCostumeName.trim();
                if (!clean) return;
                setCostumes(name, (l) => [...l, { id: newCostumeId(), name: clean, imageAssetId: null, notes: '' }]);
                setNewCostumeName('');
              }}
            >
              <input
                className="sp-input"
                value={newCostumeName}
                placeholder={t('characters.newCostumePlaceholder')}
                aria-label={t('characters.addCostume')}
                onChange={(e) => setNewCostumeName(e.target.value)}
              />
              <button type="submit" className="sp-btn" disabled={!newCostumeName.trim()}>{t('characters.addCostume')}</button>
            </form>
          </div>
        </div>

        <div className="sp-field">
          <label className="sp-label">{t('characters.field.color')}</label>
          <div className="sp-swatches">
            {SWATCHES.map((c) => (
              <button key={c} type="button" aria-label={c} className={`synopsis-color-swatch${(prof.color || '') === c ? ' active' : ''}`}
                style={{ background: c }} onClick={() => upsertCharacterProfile(name, { color: c })} />
            ))}
            <label className="synopsis-color-custom" title={t('characters.customColor')}>
              <input type="color" value={prof.color || '#999999'} onChange={(e) => upsertCharacterProfile(name, { color: e.target.value })} />
              <span>+</span>
            </label>
            <span className="sp-grow" />
            <label className="sp-label" style={{ margin: 0 }}>{t('characters.field.highlight')}</label>
            <button
              type="button"
              className={`char-profile-highlight-btn${prof.highlighted ? ' active' : ''}`}
              aria-pressed={prof.highlighted}
              onClick={() => upsertCharacterProfile(name, { highlighted: !prof.highlighted })}
              style={prof.highlighted ? { background: prof.color || '#999', borderColor: prof.color || '#999' } : undefined}
            >
              {prof.highlighted ? t('common:on') : t('common:off')}
            </button>
          </div>
        </div>
      </>
    );
  };

  const renderStoryTab = (name: string, prof: CharacterProfile) => (
    <>
      <div className="sp-field">
        <label className="sp-label">{t('characters.field.backstory')}</label>
        <MiniRichText value={prof.backstory} onChange={(html) => upsertCharacterProfile(name, { backstory: html })}
          placeholder={t('characters.placeholder.backstory')} minHeight={110} />
      </div>
      <div className="sp-field">
        <label className="sp-label">{t('characters.field.arc')}</label>
        <MiniRichText value={prof.arc || ''} onChange={(html) => upsertCharacterProfile(name, { arc: html })}
          placeholder={t('characters.placeholder.arc')} minHeight={80} />
      </div>
    </>
  );

  const renderVoiceTab = (name: string, prof: CharacterProfile) => (
    <>
      <div className="char-profile-tts-voice">
        <label className="sp-label" htmlFor={`tts-voice-${name}`}>{t('characters.tableReadVoice')}</label>
        <VoicePicker
          id={`tts-voice-${name}`}
          value={prof.voice}
          onChange={(slot, id) => {
            const voice = { ...(prof.voice ?? {}) };
            if (id) voice[slot] = id;
            else delete voice[slot];
            upsertCharacterProfile(name, { voice });
          }}
          sample={singleLine(prof.sampleDialogue ? stripHtml(prof.sampleDialogue) : '').slice(0, 160) || /* i18n-ignore: spoken sample text for the English voice engine */ `Hello, I'm ${name.charAt(0) + name.slice(1).toLowerCase()}.`}
          automaticVoiceId={tableReadCasting[name]}
        />
      </div>
      <div className="sp-sec">{t('characters.field.voiceProfile')}</div>
      <div className="sp-cols2">
        <div className="sp-field">
          <label className="sp-label">{t('characters.field.speechPattern')}</label>
          <MiniRichText value={prof.speechPattern || ''} onChange={(html) => upsertCharacterProfile(name, { speechPattern: html })}
            placeholder={t('characters.placeholder.speechPatternShort')} minHeight={44} />
        </div>
        <div className="sp-field">
          <label className="sp-label">{t('characters.field.vocabulary')}</label>
          <MiniRichText value={prof.vocabulary || ''} onChange={(html) => upsertCharacterProfile(name, { vocabulary: html })}
            placeholder={t('characters.placeholder.vocabularyShort')} minHeight={44} />
        </div>
        <div className="sp-field">
          <label className="sp-label">{t('characters.field.verbalTics')}</label>
          <MiniRichText value={prof.verbalTics || ''} onChange={(html) => upsertCharacterProfile(name, { verbalTics: html })}
            placeholder={t('characters.placeholder.verbalTicsShort')} minHeight={44} />
        </div>
        <div className="sp-field">
          <label className="sp-label">{t('characters.field.sampleDialogue')}</label>
          <MiniRichText value={prof.sampleDialogue || ''} onChange={(html) => upsertCharacterProfile(name, { sampleDialogue: html })}
            placeholder={t('characters.placeholder.sampleDialogueShort')} minHeight={44} />
        </div>
      </div>
    </>
  );

  const renderRelationshipsTab = (name: string) => {
    const rels = characterRelationships.filter((r) => r.characterA === name || r.characterB === name);
    const isAdding = addRelFor === name;
    return (
      <div className="char-profile-relationships">
        {rels.map((r) => {
          const other = r.characterA === name ? r.characterB : r.characterA;
          return (
            <div key={r.id} className="char-profile-rel-item">
              <div className="char-profile-rel-header">
                <button type="button" className="sp-link char-profile-rel-other" onClick={() => openCharacter(other, 'relationships')}>{other}</button>
                <span className="char-profile-rel-type">{relTypeLabel(t, r.type)}</span>
                {r.dynamic && <span className="char-profile-rel-dynamic">{relDynamicLabel(t, r.dynamic)}</span>}
                <button className="char-profile-rel-remove" onClick={() => deleteCharacterRelationship(r.id)} title={t('characters.removeRelationship')}>&times;</button>
              </div>
              {r.description && <div className="char-profile-rel-desc">{r.description}</div>}
            </div>
          );
        })}
        {rels.length === 0 && !isAdding && <div className="char-profile-rel-empty">{t('characters.noRelationships')}</div>}
        {isAdding ? (
          <InlineRelForm
            characterName={name}
            allCharacters={allCharacters}
            onSave={(rel) => { upsertCharacterRelationship(rel); setAddRelFor(null); }}
            onCancel={() => setAddRelFor(null)}
          />
        ) : (
          <div className="sp-chips" style={{ marginTop: 8 }}>
            <button type="button" className="sp-btn sp-btn-dashed" onClick={() => setAddRelFor(name)}>{t('characters.addRelationship')}</button>
            <button type="button" className="sp-btn" onClick={() => { setListView('map'); if (!sideBySide) setCurrent(null); }}>{t('characters.openMap')}</button>
          </div>
        )}
      </div>
    );
  };

  const renderScenesTab = (name: string, prof: CharacterProfile) => {
    const stats = charStats.get(name);
    const scenes = stats?.scenes ?? [];
    if (!scenes.length) return <div className="sp-note">{t('characters.noScenesYet')}</div>;
    const owned = prof.costumes ?? [];
    const costumeName = (id: string) => owned.find((c) => c.id === id)?.name ?? t('sceneDetails.costumeGone');
    const rows = scenes.map((s, i) => {
      const worn = costumesIn(s.details, name);
      const prev = i ? costumesIn(scenes[i - 1].details, name) : [];
      const changed = i > 0 && worn.length > 0 && prev.length > 0 && prev[prev.length - 1].costumeId !== worn[0].costumeId;
      const record = s.location ? locationNamed(locations, s.location) : null;
      const look = record ? lookForScene(record.looks, s.details.lookId, s.timeOfDay) : null;
      const member = s.cast.find((m) => m.name === name);
      return { s, worn, changed, record, look, lines: member?.lines ?? 0, silent: !!member?.silent, with: s.cast.filter((m) => m.name !== name).map((m) => m.name) };
    }).filter((r) => !costumeFilter || r.worn.some((w) => w.costumeId === costumeFilter));

    const costumesCell = (r: typeof rows[number]) => (r.worn.length ? (
      <span className="sp-chips">
        {r.worn.map((w, j) => (
          <React.Fragment key={w.costumeId}>
            {j > 0 && <span className="sp-note">{t('characters.then')}</span>}
            <span className="sp-chip" title={w.when || undefined}>{costumeName(w.costumeId)}</span>
          </React.Fragment>
        ))}
        {r.changed && <span className="sp-change">{t('characters.change')}</span>}
      </span>
    ) : <span className="sp-note">{t('characters.notSet')}</span>);
    const locationCell = (r: typeof rows[number]) => (r.s.location ? (
      <span>
        <button type="button" className="sp-link" onClick={() => {
          setProfileFocus({ panel: 'locations', name: r.record?.name ?? r.s.location, tab: 'scenes' });
          jumpToPanel('location-db', 'characters');
        }}>{r.record?.name ?? r.s.location}</button>
        {r.look && <span className="sp-note"> {r.look.name}</span>}
      </span>
    ) : <span className="sp-note">—</span>);
    const withCell = (r: typeof rows[number]) => (r.with.length ? r.with.join(', ') : <span className="sp-note">{t('characters.alone')}</span>);
    const linesCell = (r: typeof rows[number]) => (r.silent ? t('sceneDetails.doesNotSpeak') : r.lines);

    return (
      <>
        <div className="sp-chips">
          <button type="button" className={`sp-btn${!costumeFilter ? ' sp-btn-primary' : ''}`} onClick={() => setCostumeFilter('')}>
            {t('characters.allScenes', { count: scenes.length })}
          </button>
          {owned.map((c) => (
            <button key={c.id} type="button" className={`sp-btn${costumeFilter === c.id ? ' sp-btn-primary' : ''}`} onClick={() => setCostumeFilter(c.id)}>
              {c.name} · {scenes.filter((s) => costumesIn(s.details, name).some((w) => w.costumeId === c.id)).length}
            </button>
          ))}
        </div>
        {sideBySide ? (
          <div className="sp-table-wrap">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>{t('characters.col.number')}</th><th>{t('characters.col.scene')}</th><th>{t('characters.col.location')}</th>
                  <th>{t('characters.col.costumes')}</th><th>{t('characters.col.with')}</th><th>{t('characters.col.lines')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.s.pos}>
                    <td className="sp-note">{r.s.number ?? r.s.index + 1}</td>
                    <td><button type="button" className="sp-link" onClick={() => openScene(r.s)}>{r.s.heading || t('sceneDetails.untitled')}</button></td>
                    <td>{locationCell(r)}</td>
                    <td>{costumesCell(r)}</td>
                    <td>{withCell(r)}</td>
                    <td>{linesCell(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sp-stack" style={{ gap: 8 }}>
            {rows.map((r) => (
              <div key={r.s.pos} className="sp-scard">
                <div className="sp-scard-head">
                  <span className="sp-scene-num" style={r.s.color ? { background: r.s.color } : undefined}>{r.s.number ?? r.s.index + 1}</span>
                  <button type="button" className="sp-link" onClick={() => openScene(r.s)}>{r.s.heading || t('sceneDetails.untitled')}</button>
                  <span className="sp-grow" />
                  <span className="sp-note" style={{ whiteSpace: 'nowrap' }}>{r.silent ? t('sceneDetails.doesNotSpeak') : t('characters.linesShort', { count: r.lines })}</span>
                </div>
                <dl className="sp-kv">
                  <dt>{t('characters.costumes')}</dt><dd>{costumesCell(r)}</dd>
                  <dt>{t('characters.col.location')}</dt><dd>{locationCell(r)}</dd>
                  <dt>{t('characters.col.with')}</dt><dd>{withCell(r)}</dd>
                </dl>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  const detail = (name: string) => {
    const prof = getProfile(name);
    const stats = charStats.get(name);
    const image = prof.images?.[0];
    const relCount = characterRelationships.filter((r) => r.characterA === name || r.characterB === name).length;
    return (
      <div className="sp-detail">
        <div className="sp-head">
          {!sideBySide && (
            <button type="button" className="sp-icon-btn" onClick={() => setCurrent(null)} title={t('characters.backToList')} aria-label={t('characters.backToList')}>&#8249;</button>
          )}
          {image && projectId
            ? <img className="sp-avatar" style={{ width: 26, height: 26 }} src={getAssetUrl(image)} alt="" />
            : <span className="sp-avatar" style={{ width: 26, height: 26, fontSize: 10, background: prof.color || '#999' }} aria-hidden="true">{initials(name)}</span>}
          <h2 className="sp-title sp-title-record">{name}</h2>
          <CompletenessRing fields={completenessFields(prof)} />
          <span className="sp-grow" />
          {stats && (
            <button type="button" className="sp-icon-btn" onClick={() => handleNavigateToCharacter(name)} title={t('characters.navigateToFirst')} aria-label={t('characters.navigateToFirst')}>&#8594;</button>
          )}
          <button type="button" className="sp-btn" onClick={() => setRenamingCharacter(name)} title={t('characters.renameEverywhere')} aria-label={t('characters.renameNamed', { name })}>
            {t('characters.rename')}
          </button>
          {!sideBySide && (
            <>
              <button type="button" className="sp-icon-btn sp-wide-btn" onClick={() => setIsWide(true)} title={t('storyPanels.wideView')} aria-label={t('storyPanels.wideView')}>&#x26F6;</button>
              <button type="button" className="sp-icon-btn" onClick={close} title={t('common:close')} aria-label={t('common:close')}>&times;</button>
            </>
          )}
        </div>
        <StoryPanelTabs
          value={tab}
          onChange={setTab}
          label={name}
          tabs={[
            { id: 'profile', label: t('characters.tab.profile') },
            { id: 'story', label: t('characters.tab.story') },
            { id: 'voice', label: t('characters.tab.voice') },
            { id: 'relationships', label: <>{t('characters.tab.relationships')}{relCount > 0 && <span className="sp-tab-count">{relCount}</span>}</> },
            { id: 'scenes', label: <>{t('characters.tab.scenes')}{stats && <span className="sp-tab-count">{stats.sceneCount}</span>}</> },
          ]}
        />
        <div className="sp-body">
          {orphanedNames.has(name) && (
            <div className="sp-banner">
              <span>{t('characters.notInScript')}</span>
              <span className="sp-grow" />
              <button type="button" className="sp-btn sp-btn-danger" onClick={() => setPendingRemoveChar(name)}>{t('common:remove')}</button>
            </div>
          )}
          {tab === 'profile' && renderProfileTab(name, prof)}
          {tab === 'story' && renderStoryTab(name, prof)}
          {tab === 'voice' && renderVoiceTab(name, prof)}
          {tab === 'relationships' && renderRelationshipsTab(name)}
          {tab === 'scenes' && renderScenesTab(name, prof)}
        </div>
      </div>
    );
  };

  const showRecordAlone = !sideBySide && !!currentName && listView === 'profiles';

  return (
    <div
      ref={panelRef}
      className={`char-profiles-panel sp-panel${isWide ? ' sp-wide-overlay' : ''}${sideBySide ? '' : ' sp-narrow'} ${panelClass}`}
      style={isWide ? undefined : style}
    >
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileSelect} />

      {!showRecordAlone && (
        <StoryPanelHeader
          title={t('characters.title')}
          count={allCharacters.length}
          wide={isWide}
          onToggleWide={() => setIsWide((w) => !w)}
          onClose={close}
        />
      )}

      {listView === 'map' ? (
        <>{tabsBar}{map}</>
      ) : showRecordAlone && currentName ? (
        detail(currentName)
      ) : (
        <div className="sp-md">
          {list}
          {sideBySide && shownName && detail(shownName)}
        </div>
      )}

      {/* Referred in Script overlay panel */}
      {showReferred && (
        <div className="char-referred-overlay">
          <div className="char-referred-panel">
            <div className="char-referred-header">
              <span>{t('characters.referredTitle')}</span>
              <button className="char-profiles-close" onClick={() => setShowReferred(false)}>&times;</button>
            </div>
            <div className="char-referred-desc">{t('characters.referredHelp')}</div>
            <div className="char-referred-list">
              {unmatchedNames.map((name) => (
                <div key={name} className="char-unmatched-row">
                  <span className="char-unmatched-name">{name}</span>
                  <button className="char-unmatched-add" onClick={() => handleAddUnmatched(name)} title={t('characters.addToList')}>
                    {t('characters.addRelationship')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {imagePickerFor && (
        <AssetImagePicker
          title={t('characters.selectImageFor', { name: imagePickerFor })}
          assets={assets}
          linkedIds={characterProfiles.find((p) => p.name === imagePickerFor)?.images || []}
          emptyText={t('characters.noImageAssets')}
          getUrl={getAssetUrl}
          onPick={(assetId) => handleAssociateAsset(imagePickerFor, assetId)}
          onClose={() => setImagePickerFor(null)}
        />
      )}

      {lightboxImage && (
        <ImageLightbox url={lightboxImage.url} name={lightboxImage.name} onClose={() => setLightboxImage(null)} />
      )}

      {pendingRemoveChar && (
        <ModalOverlay className="dialog-overlay" onClick={() => setPendingRemoveChar(null)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">{t('characters.removeTitle')}</div>
            <div className="dialog-body">
              <p style={{ margin: 0 }}>{t('characters.removeConfirm', { name: pendingRemoveChar })}</p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setPendingRemoveChar(null)}>{t('common:cancel')}</button>
              <button
                className="dialog-primary"
                style={{ background: '#c0392b' }}
                onClick={() => {
                  deleteCharacterProfile(pendingRemoveChar);
                  if (current === pendingRemoveChar) setCurrent(null);
                  setPendingRemoveChar(null);
                }}
              >
                {t('common:remove')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default CharacterProfiles;
