import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import DOMPurify from 'dompurify';
import { useTranslation } from 'react-i18next';
import { compareText } from '../i18n/format';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import { useEditorStore, type CharacterProfile, type CharacterRelationship } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { characterKey, singleLine } from '../utils/nodeText';
import { useAssetStore } from '../stores/assetStore';
import { api } from '../services/api';
import { showToast } from './Toast';
import MiniRichText from './MiniRichText';
import { RelationshipMap, relTypeLabel, relDynamicLabel, characterRoleLabel } from './RelationshipMap';
import VoicePicker from './VoicePicker';
import { useTableReadStore } from '../stores/tableReadStore';
import Select from './Select';
import { useEditorTransactions } from '../hooks/useEditorTransactions';

// Default colors for auto-assignment (VIBGYOR palette)
const DEFAULT_HIGHLIGHT_COLORS = [
  '#8b5cf6', '#4f46e5', '#2563eb', '#059669', '#eab308',
  '#f97316', '#ef4444', '#000000',
];

// Character roles matching industry standard (Final Draft Character Navigator)
const CHARACTER_ROLES = ['', 'Lead', 'Supporting', 'Featured', 'Background', 'Day Player'];

/** Strip HTML tags to get plain text (for collapsed preview and FDX export) */
function stripHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: [] }).replace(/\s+/g, ' ').trim();
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

  const currentScriptId = useProjectStore((s) => s.currentScriptId);
  const { assets, setAssets } = useAssetStore();

  const [activeTab, setActiveTab] = useState<'profiles' | 'map'>('profiles');
  const [addRelFor, setAddRelFor] = useState<string | null>(null); // character name to add rel for
  const [expandedChar, setExpandedChar] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showReferred, setShowReferred] = useState(false);
  const sortBy = useEditorStore((s) => s.characterSortBy);
  const setSortBy = useEditorStore((s) => s.setCharacterSortBy);
  const setRenamingCharacter = useEditorStore((s) => s.setRenamingCharacter);
  const [pendingRemoveChar, setPendingRemoveChar] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsViewMode, setFsViewMode] = useState<'cards' | 'list'>('cards');
  const [modalChar, setModalChar] = useState<string | null>(null);

  // Image picker state
  const [imagePickerFor, setImagePickerFor] = useState<string | null>(null);
  const [imagePickerFilter, setImagePickerFilter] = useState('');
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Fetch project assets when image picker opens
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

  // When a character is clicked in the editor, expand it in the panel
  useEffect(() => {
    if (selectedCharacter) {
      setExpandedChar(selectedCharacter);
      setSelectedCharacter(null);
      setTimeout(() => {
        const card = document.querySelector(`[data-char-name="${selectedCharacter}"]`);
        card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  }, [selectedCharacter, setSelectedCharacter]);

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
        // Find sentence boundaries
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

  // Compute stats per character: dialogue count, scene appearances, order of appearance
  interface CharStats { dialogueCount: number; sceneCount: number; scenes: string[]; appearanceOrder: number }
  const charStats = useMemo((): Map<string, CharStats> => {
    if (!editor) return new Map();
    const stats = new Map<string, { dialogueCount: number; scenes: Set<string>; appearanceOrder: number }>();

    let currentScene = '';
    let currentChar = '';
    let orderCounter = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'sceneHeading') {
        // Normalized identically to the lookup below — both sides must agree or
        // the scene match silently fails.
        currentScene = singleLine(node.textContent);
      }
      if (node.type.name === 'character') {
        currentChar = characterKey(node.textContent);
        if (!stats.has(currentChar)) {
          stats.set(currentChar, { dialogueCount: 0, scenes: new Set(), appearanceOrder: orderCounter++ });
        }
        const s = stats.get(currentChar)!;
        if (currentScene) s.scenes.add(currentScene);
      }
      if (node.type.name === 'dialogue' && currentChar) {
        const s = stats.get(currentChar);
        if (s) s.dialogueCount++;
      }
      return true;
    });

    const result = new Map<string, CharStats>();
    for (const [name, s] of stats) {
      result.set(name, { dialogueCount: s.dialogueCount, sceneCount: s.scenes.size, scenes: Array.from(s.scenes), appearanceOrder: s.appearanceOrder });
    }
    return result;
  }, [editor, editor?.state.doc]);

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

      if (targetPos !== null) {
        editor.chain().focus().setTextSelection(targetPos).run();
        const coords = editor.view.coordsAtPos(targetPos);
        const editorMain = document.querySelector('.editor-main');
        if (editorMain && coords) {
          const rect = editorMain.getBoundingClientRect();
          const scrollTo = editorMain.scrollTop + (coords.top - rect.top) - rect.height / 3;
          editorMain.scrollTo({ top: scrollTo, behavior: 'auto' });
        }
      }
    },
    [editor],
  );

  /** Navigate to a scene heading in the script */
  const handleNavigateToScene = useCallback(
    (sceneText: string) => {
      if (!editor) return;
      let targetPos: number | null = null;

      editor.state.doc.descendants((node, pos) => {
        if (targetPos !== null) return false;
        if (node.type.name === 'sceneHeading') {
          if (singleLine(node.textContent) === sceneText) {
            targetPos = pos + 1;
            return false;
          }
        }
        return true;
      });

      if (targetPos !== null) {
        editor.chain().focus().setTextSelection(targetPos).run();
        const coords = editor.view.coordsAtPos(targetPos);
        const editorMain = document.querySelector('.editor-main');
        if (editorMain && coords) {
          const rect = editorMain.getBoundingClientRect();
          const scrollTo = editorMain.scrollTop + (coords.top - rect.top) - rect.height / 3;
          editorMain.scrollTo({ top: scrollTo, behavior: 'auto' });
        }
      }
    },
    [editor],
  );

  // Detect potential characters mentioned in action lines (ALL-CAPS words 2+ chars)
  // that are not yet in the character list — these may be non-speaking characters
  const unmatchedNames = useMemo(() => {
    if (!editor) return [];
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
    editor.state.doc.descendants((node) => {
      if (node.type.name !== 'action') return true;
      const text = node.textContent;
      // Match sequences of 2+ uppercase words (character names are often multi-word)
      const regex = /\b([A-Z][A-Z.'\- ]{1,30}[A-Z])\b/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const candidate = match[1].trim();
        // Must be 2+ chars and not be an excluded common word
        if (candidate.length < 2) continue;
        const words = candidate.split(/\s+/);
        if (words.every((w) => EXCLUDE.has(w.replace(/[.']/g, '')))) continue;
        // Must not already be known
        if (known.has(candidate)) continue;
        found.add(candidate);
      }
      return true;
    });

    return Array.from(found).sort();
  }, [editor, editor?.state.doc, characters, characterProfiles]);

  const handleAddUnmatched = useCallback(
    (name: string) => {
      const colorIdx = characterProfiles.length % DEFAULT_HIGHLIGHT_COLORS.length;
      upsertCharacterProfile(name, { color: DEFAULT_HIGHLIGHT_COLORS[colorIdx] });
    },
    [characterProfiles, upsertCharacterProfile],
  );

  // Characters that have a profile but are no longer detected in the script
  // Scan the editor doc directly so we don't depend on the store's `characters` timing
  const scriptCharacterNames = useMemo(() => {
    const names = new Set<string>();
    if (!editor) return names;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'character') {
        const base = characterKey(node.textContent);
        if (base) names.add(base);
      }
      return true;
    });
    return names;
  }, [editor, editor?.state.doc]);

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
          // scenes + dialogues descending
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
      return { name, description: '', color: '', highlighted: false, gender: '', age: '', role: '', backstory: '', arc: '', speechPattern: '', vocabulary: '', verbalTics: '', sampleDialogue: '', images: [] };
    },
    [characterProfiles],
  );

  // Voices Table Read cast automatically, shown beside "Automatic".
  const tableReadCasting = useTableReadStore((s) => s.casting);

  /** The Table Read voice for a character (issue #131). */
  const renderTableReadVoice = (charName: string, prof: CharacterProfile) => (
    <div className="char-profile-tts-voice">
      <label className="char-profile-label" htmlFor={`tts-voice-${charName}`}>{t('characters.tableReadVoice')}</label>
      <VoicePicker
        id={`tts-voice-${charName}`}
        value={prof.voice}
        onChange={(slot, id) => {
          const voice = { ...(prof.voice ?? {}) };
          if (id) voice[slot] = id;
          else delete voice[slot];
          upsertCharacterProfile(charName, { voice });
        }}
        sample={singleLine(prof.sampleDialogue ? stripHtml(prof.sampleDialogue) : '').slice(0, 160) || /* i18n-ignore: spoken sample text for the English voice engine */ `Hello, I'm ${charName.charAt(0) + charName.slice(1).toLowerCase()}.`}
        automaticVoiceId={tableReadCasting[charName]}
      />
    </div>
  );

  /** Calculate profile completeness as percentage + field breakdown */
  const getProfileCompleteness = useCallback((profile: CharacterProfile) => {
    const fields: { label: string; filled: boolean }[] = [
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
    ];
    const filled = fields.filter((f) => f.filled).length;
    const pct = Math.round((filled / fields.length) * 100);
    return { pct, filled, total: fields.length, fields };
  }, [t]);

  // Image helpers
  const getAssetUrl = useCallback((assetId: string) => {
    return api.getAssetUrl(projectId, assetId);
  }, [projectId]);

  const imageAssets = useMemo(() => {
    return assets.filter((a) => a.mime_type.startsWith('image/'));
  }, [assets]);

  const handleUploadImage = useCallback(async (charName: string, file: File) => {
    if (!projectId) return;
    setUploading(true);
    try {
      const data = await api.uploadAsset(projectId, file, [`character:${charName}`]);
      const assetId = data.id || data.asset?.id;
      if (assetId) {
        const profile = characterProfiles.find((p) => p.name === charName);
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
  }, [projectId, characterProfiles, upsertCharacterProfile, fetchAssets, t]);

  const handleAssociateAsset = useCallback((charName: string, assetId: string) => {
    const profile = characterProfiles.find((p) => p.name === charName);
    const currentImages = profile?.images || [];
    if (!currentImages.includes(assetId)) {
      upsertCharacterProfile(charName, { images: [...currentImages, assetId] });
    }
    setImagePickerFor(null);
    setImagePickerFilter('');
  }, [characterProfiles, upsertCharacterProfile]);

  const handleRemoveImage = useCallback((charName: string, assetId: string) => {
    const profile = characterProfiles.find((p) => p.name === charName);
    const currentImages = profile?.images || [];
    upsertCharacterProfile(charName, { images: currentImages.filter((id) => id !== assetId) });
  }, [characterProfiles, upsertCharacterProfile]);

  const handleSetPrimaryImage = useCallback((charName: string, assetId: string) => {
    const profile = characterProfiles.find((p) => p.name === charName);
    const currentImages = profile?.images || [];
    const filtered = currentImages.filter((id) => id !== assetId);
    upsertCharacterProfile(charName, { images: [assetId, ...filtered] });
  }, [characterProfiles, upsertCharacterProfile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const charName = uploadTargetRef.current;
    if (file && charName) {
      handleUploadImage(charName, file);
    }
    e.target.value = '';
  }, [handleUploadImage]);

  const triggerUpload = useCallback((charName: string) => {
    uploadTargetRef.current = charName;
    fileInputRef.current?.click();
  }, []);

  /** Render character detail fields — used in both card expansion and modal */
  const renderCharacterFields = (charName: string, isModal: boolean) => {
    const prof = getProfile(charName);
    const st = charStats.get(charName);
    return (
      <>
        {/* Description */}
        <label className="char-profile-label">{t('characters.field.description')}</label>
        <MiniRichText
          value={prof.description}
          onChange={(html) => upsertCharacterProfile(charName, { description: html })}
          placeholder={t('characters.placeholder.description')}
          minHeight={isModal ? 80 : 50}
        />

        {/* Role / Gender / Age */}
        <div className="char-profile-meta-row char-profile-meta-row-3">
          <div className="char-profile-meta-field">
            <label className="char-profile-label">{t('characters.field.role')}</label>
            <Select
              className="char-profile-select"
              value={prof.role}
              onChange={(e) => upsertCharacterProfile(charName, { role: e.target.value })}
            >
              {CHARACTER_ROLES.map((r) => (
                <option key={r} value={r}>{r ? characterRoleLabel(t, r) : '—'}</option>
              ))}
            </Select>
          </div>
          <div className="char-profile-meta-field">
            <label className="char-profile-label">{t('characters.field.gender')}</label>
            <input
              type="text"
              className="char-profile-input"
              value={prof.gender}
              onChange={(e) => upsertCharacterProfile(charName, { gender: e.target.value })}
              placeholder={t('characters.placeholder.gender')}
            />
          </div>
          <div className="char-profile-meta-field">
            <label className="char-profile-label">{t('characters.field.age')}</label>
            <input
              type="text"
              className="char-profile-input"
              value={prof.age}
              onChange={(e) => upsertCharacterProfile(charName, { age: e.target.value })}
              placeholder={t('characters.placeholder.age')}
            />
          </div>
        </div>

        {/* Images */}
        {prof.images && prof.images.length > 0 && projectId && (
          <div className="char-profile-images">
            <div className="char-profile-images-primary">
              <img
                src={getAssetUrl(prof.images[0])}
                alt={charName}
                className="char-profile-image-main"
                onClick={() => setLightboxImage({ url: getAssetUrl(prof.images[0]), name: charName })}
              />
            </div>
            {prof.images.length > 1 && (
              <div className="char-profile-images-strip">
                {prof.images.map((imgId, idx) => (
                  <div key={imgId} className={`char-profile-thumb-wrap${idx === 0 ? ' active' : ''}`}>
                    <img
                      src={getAssetUrl(imgId)}
                      alt={`${charName} ${idx + 1}`}
                      className="char-profile-thumb"
                      onClick={() => setLightboxImage({ url: getAssetUrl(imgId), name: charName })}
                    />
                    {idx > 0 && (
                      <button
                        className="char-profile-thumb-primary"
                        onClick={() => handleSetPrimaryImage(charName, imgId)}
                        title={t('characters.setPrimaryImage')}
                      >
                        &#9733;
                      </button>
                    )}
                    <button
                      className="char-profile-thumb-remove"
                      onClick={() => handleRemoveImage(charName, imgId)}
                      title={t('characters.removeImage')}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {projectId && (
          <div className="char-profile-image-actions">
            <button
              className="char-profile-img-btn"
              onClick={() => triggerUpload(charName)}
              disabled={uploading}
              title={t('characters.uploadImageTitle')}
            >
              {uploading ? t('characters.uploading') : t('characters.uploadImage')}
            </button>
            <button
              className="char-profile-img-btn"
              onClick={() => { setImagePickerFor(charName); setImagePickerFilter(''); }}
              title={t('characters.fromAssetsTitle')}
            >
              {t('characters.fromAssets')}
            </button>
          </div>
        )}

        {/* Backstory */}
        <label className="char-profile-label">{t('characters.field.backstory')}</label>
        <MiniRichText
          value={prof.backstory}
          onChange={(html) => upsertCharacterProfile(charName, { backstory: html })}
          placeholder={t('characters.placeholder.backstory')}
          minHeight={isModal ? 100 : 60}
        />

        {/* Character Arc */}
        <label className="char-profile-label">{t('characters.field.arc')}</label>
        <MiniRichText
          value={prof.arc || ''}
          onChange={(html) => upsertCharacterProfile(charName, { arc: html })}
          placeholder={t('characters.placeholder.arc')}
          minHeight={isModal ? 80 : 50}
        />

        {renderTableReadVoice(charName, prof)}

        {/* Voice Profile (collapsible) */}
        <details className="char-profile-voice-section">
          <summary className="char-profile-label char-profile-voice-toggle">{t('characters.field.voiceProfile')}</summary>
          <div className="char-profile-voice-fields">
            <label className="char-profile-label">{t('characters.field.speechPattern')}</label>
            <MiniRichText
              value={prof.speechPattern || ''}
              onChange={(html) => upsertCharacterProfile(charName, { speechPattern: html })}
              placeholder={t('characters.placeholder.speechPattern')}
              minHeight={40}
            />
            <label className="char-profile-label">{t('characters.field.vocabulary')}</label>
            <MiniRichText
              value={prof.vocabulary || ''}
              onChange={(html) => upsertCharacterProfile(charName, { vocabulary: html })}
              placeholder={t('characters.placeholder.vocabulary')}
              minHeight={40}
            />
            <label className="char-profile-label">{t('characters.field.verbalTics')}</label>
            <MiniRichText
              value={prof.verbalTics || ''}
              onChange={(html) => upsertCharacterProfile(charName, { verbalTics: html })}
              placeholder={t('characters.placeholder.verbalTics')}
              minHeight={40}
            />
            <label className="char-profile-label">{t('characters.field.sampleDialogue')}</label>
            <MiniRichText
              value={prof.sampleDialogue || ''}
              onChange={(html) => upsertCharacterProfile(charName, { sampleDialogue: html })}
              placeholder={t('characters.placeholder.sampleDialogue')}
              minHeight={40}
            />
          </div>
        </details>

        {/* Color + Highlight */}
        <div className="char-profile-color-highlight">
          <label className="char-profile-label">{t('characters.field.color')}</label>
          <div className="char-color-swatches">
            {['#8b5cf6','#4f46e5','#2563eb','#059669','#eab308','#f97316','#ef4444','#000000','#ffffff'].map(c => (
              <button key={c} className={`synopsis-color-swatch${(prof.color || '') === c ? ' active' : ''}`} style={{ background: c }} onClick={() => upsertCharacterProfile(charName, { color: c })} />
            ))}
            <label className="synopsis-color-custom" title={t('characters.customColor')}>
              <input type="color" value={prof.color || '#999999'} onChange={(e) => upsertCharacterProfile(charName, { color: e.target.value })} />
              <span>+</span>
            </label>
          </div>
          <div className="char-profile-highlight-inline">
            <label className="char-profile-label" style={{ marginBottom: 0 }}>{t('characters.field.highlight')}</label>
            <button
              className={`char-profile-highlight-btn${prof.highlighted ? ' active' : ''}`}
              onClick={() => upsertCharacterProfile(charName, { highlighted: !prof.highlighted })}
              style={prof.highlighted ? { background: prof.color || '#999', borderColor: prof.color || '#999' } : undefined}
            >
              {prof.highlighted ? t('common:on') : t('common:off')}
            </button>
          </div>
        </div>

        {/* Relationships (before scenes) */}
        {(() => {
          const nameUpper = charName.toUpperCase();
          const rels = characterRelationships.filter(
            (r) => r.characterA === nameUpper || r.characterB === nameUpper
          );
          const isAdding = addRelFor === nameUpper;
          return (
            <div className="char-profile-relationships">
              <div className="char-profile-rel-header-row">
                <label className="char-profile-label" style={{ marginBottom: 0 }}>{t('characters.field.relationships')}</label>
                {!isAdding && (
                  <button className="char-profile-rel-add-btn" onClick={() => setAddRelFor(nameUpper)}>{t('characters.addRelationship')}</button>
                )}
              </div>
              {rels.map((r) => {
                const other = r.characterA === nameUpper ? r.characterB : r.characterA;
                return (
                  <div key={r.id} className="char-profile-rel-item">
                    <div className="char-profile-rel-header">
                      <span className="char-profile-rel-other">{other}</span>
                      <span className="char-profile-rel-type">{relTypeLabel(t, r.type)}</span>
                      {r.dynamic && <span className="char-profile-rel-dynamic">{relDynamicLabel(t, r.dynamic)}</span>}
                      <button
                        className="char-profile-rel-remove"
                        onClick={() => deleteCharacterRelationship(r.id)}
                        title={t('characters.removeRelationship')}
                      >&times;</button>
                    </div>
                    {r.description && <div className="char-profile-rel-desc">{r.description}</div>}
                  </div>
                );
              })}
              {rels.length === 0 && !isAdding && (
                <div className="char-profile-rel-empty">{t('characters.noRelationships')}</div>
              )}
              {isAdding && (
                <InlineRelForm
                  characterName={nameUpper}
                  allCharacters={allCharacters}
                  onSave={(rel) => {
                    upsertCharacterRelationship(rel);
                    setAddRelFor(null);
                  }}
                  onCancel={() => setAddRelFor(null)}
                />
              )}
            </div>
          );
        })()}

        {/* Scene appearances (collapsed by default) */}
        {st && st.scenes.length > 0 && (
          <details className="char-profile-scenes-collapsible">
            <summary className="char-profile-label char-profile-scenes-toggle">
              {t('characters.appearsIn', { count: st.scenes.length })}
            </summary>
            <div className="char-profile-scene-chips">
              {st.scenes.map((s, i) => (
                <span key={i} className="char-profile-scene-chip" onClick={() => handleNavigateToScene(s)} title={t('characters.goTo', { scene: s })}>{s}</span>
              ))}
            </div>
          </details>
        )}
      </>
    );
  };

  const { shouldRender, animationState } = useDelayedUnmount(characterProfilesOpen, 250);
  useEditorTransactions(editor, shouldRender);
  const panelRef = useRef<HTMLDivElement>(null);
  useSwipeDismiss(panelRef, { direction: 'right', onDismiss: toggleCharacterProfiles, enabled: shouldRender && !isFullscreen });

  if (!shouldRender) return null;

  const panelClass = !isFullscreen && animationState === 'entered'
    ? 'panel-open' : !isFullscreen && animationState === 'exiting' ? 'panel-closing' : '';

  return (
    <div ref={panelRef} className={`char-profiles-panel${isFullscreen ? ' char-profiles-fullscreen' : ''}${isFullscreen && fsViewMode === 'list' ? ' char-fs-list-mode' : ''} ${panelClass}`} style={isFullscreen ? undefined : style}>
      {/* Hidden file input for image uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      <div className="char-profiles-header">
        <span className="char-profiles-title">{t('characters.title')}</span>
        <span className="char-profiles-count">{allCharacters.length}</span>
        <button
          className="char-profiles-fullscreen-btn"
          onClick={() => setIsFullscreen(!isFullscreen)}
          title={isFullscreen ? t('characters.exitFullscreen') : t('characters.fullscreen')}
        >
          {isFullscreen ? '\u2716' : '\u26F6'}
        </button>
        {isFullscreen && (
          <div className="char-fs-view-toggle">
            <button
              className={`char-fs-view-btn${fsViewMode === 'cards' ? ' active' : ''}`}
              onClick={() => setFsViewMode('cards')}
            >
              {t('characters.viewCards')}
            </button>
            <button
              className={`char-fs-view-btn${fsViewMode === 'list' ? ' active' : ''}`}
              onClick={() => setFsViewMode('list')}
            >
              {t('characters.viewList')}
            </button>
          </div>
        )}
        <button className="char-profiles-close" onClick={() => { setIsFullscreen(false); toggleCharacterProfiles(); }} title={t('common:close')}>
          &times;
        </button>
      </div>

      {/* Tabs: Profiles / Relationship Map */}
      <div className="char-profiles-tabs">
        <button
          className={`char-profiles-tab${activeTab === 'profiles' ? ' active' : ''}`}
          onClick={() => setActiveTab('profiles')}
        >
          {t('characters.tabProfiles')}
        </button>
        <button
          className={`char-profiles-tab${activeTab === 'map' ? ' active' : ''}`}
          onClick={() => setActiveTab('map')}
        >
          {t('characters.tabMap')}
        </button>
      </div>

      {/* Relationship Map tab */}
      {activeTab === 'map' && (
        <RelationshipMap
          key={currentScriptId || 'no-script'}
          scriptId={currentScriptId || undefined}
          onSelectCharacter={(name) => {
            setActiveTab('profiles');
            setSelectedCharacter(name);
            setExpandedChar(name);
            setModalChar(name);
          }}
        />
      )}

      {/* Profiles tab content */}
      {activeTab === 'profiles' && <>

      {/* Toolbar: Search + Build */}
      <div className="char-profiles-toolbar">
        <input
          type="text"
          placeholder={t('characters.placeholder.search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="char-profiles-search-input"
        />
        <button
          className="char-profiles-build-btn"
          onClick={handleBuildFromScript}
          title={t('characters.buildFromScriptTitle')}
        >
          {t('characters.buildFromScript')}
        </button>
      </div>
      {/* Sort bar */}
      <div className="char-profiles-sort">
        <span className="char-sort-label">{t('characters.sort.label')}</span>
        <Select
          className="char-sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
        >
          <option value="name">{t('characters.sort.name')}</option>
          <option value="importance">{t('characters.sort.importance')}</option>
          <option value="scenes">{t('characters.sort.scenes')}</option>
          <option value="dialogues">{t('characters.sort.dialogues')}</option>
          <option value="appearance">{t('characters.sort.appearance')}</option>
        </Select>
      </div>

      {/* Character list */}
      <div className="char-profiles-list">
        {allCharacters.length === 0 ? (
          <div className="char-profiles-empty">
            {searchQuery
              ? t('characters.noMatch')
              : t('characters.noneDetected')}
          </div>
        ) : (
          allCharacters.map((name) => {
            const profile = getProfile(name);
            const stats = charStats.get(name);
            const isExpanded = isFullscreen || expandedChar === name;
            const isOrphaned = orphanedNames.has(name);
            const primaryImageId = profile.images?.[0];

            return (
              <div key={name} data-char-name={name} className={`char-profile-card${isOrphaned ? ' char-orphaned' : ''}`}>
                {/* Orphaned banner */}
                {isOrphaned && (
                  <div className="char-orphaned-banner">
                    <span>{t('characters.notInScript')}</span>
                    <button
                      className="char-orphaned-remove"
                      onClick={() => setPendingRemoveChar(name)}
                    >
                      {t('common:remove')}
                    </button>
                  </div>
                )}
                {/* Header row */}
                <div
                  className="char-profile-row"
                  onClick={() => setExpandedChar(isExpanded ? null : name)}
                >
                  {/* Avatar: show primary image or color swatch */}
                  {primaryImageId && projectId ? (
                    <img
                      src={getAssetUrl(primaryImageId)}
                      alt={name}
                      className="char-profile-avatar"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <input
                      type="color"
                      className="char-profile-color"
                      value={profile.color || '#999999'}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => upsertCharacterProfile(name, { color: e.target.value })}
                      title={t('characters.highlightColor')}
                    />
                  )}
                  <div className="char-profile-name-col">
                    <span
                      className="char-profile-name"
                      onClick={(e) => { e.stopPropagation(); handleNavigateToCharacter(name); }}
                      title={t('characters.navigateToFirst')}
                    >
                      {name}
                    </span>
                    {profile.description && !isExpanded && (() => {
                      const plain = stripHtml(profile.description);
                      return plain ? (
                        <span className="char-profile-desc-preview">
                          {plain.slice(0, 50)}{plain.length > 50 ? '...' : ''}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <div className="char-profile-stats">
                    {stats && (
                      <>
                        <span title={t('characters.dialogueLines', { count: stats.dialogueCount })}>{t('characters.linesShort', { count: stats.dialogueCount })}</span>
                        <span title={t('characters.inScenes', { count: stats.sceneCount })}>{t('characters.scenesShort', { count: stats.sceneCount })}</span>
                      </>
                    )}
                  </div>
                  {/* Profile completeness indicator */}
                  {(() => {
                    const comp = getProfileCompleteness(profile);
                    const color = comp.pct === 0 ? 'var(--fd-text-muted, #666)'
                      : comp.pct < 40 ? '#f44336'
                      : comp.pct < 70 ? '#ff9800'
                      : comp.pct < 100 ? '#4caf50'
                      : '#2e7d32';
                    return (
                      <div className="char-profile-completeness">
                        <svg width="22" height="22" viewBox="0 0 22 22">
                          <circle cx="11" cy="11" r="9" fill="none" stroke="var(--fd-border, #333)" strokeWidth="2" />
                          <circle
                            cx="11" cy="11" r="9" fill="none"
                            stroke={color} strokeWidth="2"
                            strokeDasharray={`${comp.pct * 0.5655} 56.55`}
                            strokeLinecap="round"
                            transform="rotate(-90 11 11)"
                          />
                        </svg>
                        <span className="char-profile-completeness-label" style={{ color }}>
                          {comp.pct}%
                        </span>
                        <div className="char-completeness-tooltip">
                          <div className="char-completeness-tooltip-title">{t('characters.profileCompleteness', { filled: comp.filled, total: comp.total })}</div>
                          {comp.fields.map((f) => (
                            <div key={f.label} className={`char-completeness-tooltip-row${f.filled ? ' filled' : ''}`}>
                              <span>{f.filled ? '\u2713' : '\u2717'}</span> {f.label}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  <button
                    className="char-profile-enlarge-btn"
                    onClick={(e) => { e.stopPropagation(); setRenamingCharacter(name); }}
                    title={t('characters.renameEverywhere')}
                    aria-label={t('characters.renameNamed', { name })}
                  >
                    &#x270E;
                  </button>
                  <button
                    className="char-profile-enlarge-btn"
                    onClick={(e) => { e.stopPropagation(); setModalChar(name); }}
                    title={t('characters.viewEnlarged')}
                  >
                    &#x26F6;
                  </button>
                  <span className={`char-profile-chevron${isExpanded ? ' expanded' : ''}`}>&#9662;</span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className={`char-profile-detail${isFullscreen && fsViewMode === 'cards' ? ' char-profile-detail-fs' : ''}`}>
                    {/* Top section: Description + Role/Gender/Age and Images (side-by-side in fullscreen) */}
                    <div className="char-profile-detail-top">
                      <div className="char-profile-detail-info">
                        {/* Description */}
                        <label className="char-profile-label">{t('characters.field.description')}</label>
                        <MiniRichText
                          value={profile.description}
                          onChange={(html) => upsertCharacterProfile(name, { description: html })}
                          placeholder={t('characters.placeholder.description')}
                          minHeight={50}
                        />

                        {/* Role / Gender / Age */}
                        <div className="char-profile-meta-row char-profile-meta-row-3">
                          <div className="char-profile-meta-field">
                            <label className="char-profile-label">{t('characters.field.role')}</label>
                            <Select
                              className="char-profile-select"
                              value={profile.role}
                              onChange={(e) => upsertCharacterProfile(name, { role: e.target.value })}
                            >
                              {CHARACTER_ROLES.map((r) => (
                                <option key={r} value={r}>{r ? characterRoleLabel(t, r) : '—'}</option>
                              ))}
                            </Select>
                          </div>
                          <div className="char-profile-meta-field">
                            <label className="char-profile-label">{t('characters.field.gender')}</label>
                            <input
                              type="text"
                              className="char-profile-input"
                              value={profile.gender}
                              onChange={(e) => upsertCharacterProfile(name, { gender: e.target.value })}
                              placeholder={t('characters.placeholder.gender')}
                            />
                          </div>
                          <div className="char-profile-meta-field">
                            <label className="char-profile-label">{t('characters.field.age')}</label>
                            <input
                              type="text"
                              className="char-profile-input"
                              value={profile.age}
                              onChange={(e) => upsertCharacterProfile(name, { age: e.target.value })}
                              placeholder={t('characters.placeholder.age')}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Images section */}
                      <div className="char-profile-detail-media">
                        {profile.images && profile.images.length > 0 && projectId && (
                          <div className="char-profile-images">
                            <div className="char-profile-images-primary">
                              <img
                                src={getAssetUrl(profile.images[0])}
                                alt={name}
                                className="char-profile-image-main"
                                onClick={() => setLightboxImage({ url: getAssetUrl(profile.images[0]), name })}
                              />
                            </div>
                            {profile.images.length > 1 && (
                              <div className="char-profile-images-strip">
                                {profile.images.map((imgId, idx) => (
                                  <div key={imgId} className={`char-profile-thumb-wrap${idx === 0 ? ' active' : ''}`}>
                                    <img
                                      src={getAssetUrl(imgId)}
                                      alt={`${name} ${idx + 1}`}
                                      className="char-profile-thumb"
                                      onClick={() => setLightboxImage({ url: getAssetUrl(imgId), name })}
                                    />
                                    {idx > 0 && (
                                      <button
                                        className="char-profile-thumb-primary"
                                        onClick={() => handleSetPrimaryImage(name, imgId)}
                                        title={t('characters.setPrimaryImage')}
                                      >
                                        &#9733;
                                      </button>
                                    )}
                                    <button
                                      className="char-profile-thumb-remove"
                                      onClick={() => handleRemoveImage(name, imgId)}
                                      title={t('characters.removeImage')}
                                    >
                                      &times;
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {projectId && (
                          <div className="char-profile-image-actions">
                            <button
                              className="char-profile-img-btn"
                              onClick={() => triggerUpload(name)}
                              disabled={uploading}
                              title={t('characters.uploadImageTitle')}
                            >
                              {uploading ? t('characters.uploading') : t('characters.uploadImage')}
                            </button>
                            <button
                              className="char-profile-img-btn"
                              onClick={() => { setImagePickerFor(name); setImagePickerFilter(''); }}
                              title={t('characters.fromAssetsTitle')}
                            >
                              {t('characters.fromAssets')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bottom section: Backstory, Arc, Color/Highlight, Scenes */}
                    <div className="char-profile-detail-bottom">
                      <label className="char-profile-label">{t('characters.field.backstory')}</label>
                      <MiniRichText
                        value={profile.backstory}
                        onChange={(html) => upsertCharacterProfile(name, { backstory: html })}
                        placeholder={t('characters.placeholder.backstory')}
                        minHeight={60}
                      />

                      <label className="char-profile-label">{t('characters.field.arc')}</label>
                      <MiniRichText
                        value={profile.arc || ''}
                        onChange={(html) => upsertCharacterProfile(name, { arc: html })}
                        placeholder={t('characters.placeholder.arc')}
                        minHeight={50}
                      />

                      {renderTableReadVoice(name, profile)}

                      {/* Voice Profile (collapsible) */}
                      <details className="char-profile-voice-section">
                        <summary className="char-profile-label char-profile-voice-toggle">{t('characters.field.voiceProfile')}</summary>
                        <div className="char-profile-voice-fields">
                          <label className="char-profile-label">{t('characters.field.speechPattern')}</label>
                          <MiniRichText
                            value={profile.speechPattern || ''}
                            onChange={(html) => upsertCharacterProfile(name, { speechPattern: html })}
                            placeholder={t('characters.placeholder.speechPatternShort')}
                            minHeight={40}
                          />
                          <label className="char-profile-label">{t('characters.field.vocabulary')}</label>
                          <MiniRichText
                            value={profile.vocabulary || ''}
                            onChange={(html) => upsertCharacterProfile(name, { vocabulary: html })}
                            placeholder={t('characters.placeholder.vocabularyShort')}
                            minHeight={40}
                          />
                          <label className="char-profile-label">{t('characters.field.verbalTics')}</label>
                          <MiniRichText
                            value={profile.verbalTics || ''}
                            onChange={(html) => upsertCharacterProfile(name, { verbalTics: html })}
                            placeholder={t('characters.placeholder.verbalTicsShort')}
                            minHeight={40}
                          />
                          <label className="char-profile-label">{t('characters.field.sampleDialogue')}</label>
                          <MiniRichText
                            value={profile.sampleDialogue || ''}
                            onChange={(html) => upsertCharacterProfile(name, { sampleDialogue: html })}
                            placeholder={t('characters.placeholder.sampleDialogueShort')}
                            minHeight={40}
                          />
                        </div>
                      </details>

                      <div className="char-profile-color-highlight">
                        <label className="char-profile-label">{t('characters.field.color')}</label>
                        <div className="char-color-swatches">
                          {['#8b5cf6','#4f46e5','#2563eb','#059669','#eab308','#f97316','#ef4444','#000000','#ffffff'].map(c => (
                            <button key={c} className={`synopsis-color-swatch${(profile.color || '') === c ? ' active' : ''}`} style={{ background: c }} onClick={() => upsertCharacterProfile(name, { color: c })} />
                          ))}
                          <label className="synopsis-color-custom" title={t('characters.customColor')}>
                            <input type="color" value={profile.color || '#999999'} onChange={(e) => upsertCharacterProfile(name, { color: e.target.value })} />
                            <span>+</span>
                          </label>
                        </div>
                        <div className="char-profile-highlight-inline">
                          <label className="char-profile-label" style={{ marginBottom: 0 }}>{t('characters.field.highlight')}</label>
                          <button
                            className={`char-profile-highlight-btn${profile.highlighted ? ' active' : ''}`}
                            onClick={() => upsertCharacterProfile(name, { highlighted: !profile.highlighted })}
                            style={profile.highlighted ? { background: profile.color || '#999', borderColor: profile.color || '#999' } : undefined}
                          >
                            {profile.highlighted ? t('common:on') : t('common:off')}
                          </button>
                        </div>
                      </div>

                      {/* Relationships (before scenes) */}
                      {(() => {
                        const rels = characterRelationships.filter(
                          (r) => r.characterA === name || r.characterB === name
                        );
                        const isAdding = addRelFor === name;
                        return (
                          <div className="char-profile-relationships">
                            <div className="char-profile-rel-header-row">
                              <label className="char-profile-label" style={{ marginBottom: 0 }}>{t('characters.field.relationships')}</label>
                              {!isAdding && (
                                <button className="char-profile-rel-add-btn" onClick={() => setAddRelFor(name)}>{t('characters.addRelationship')}</button>
                              )}
                            </div>
                            {rels.map((r) => {
                              const other = r.characterA === name ? r.characterB : r.characterA;
                              return (
                                <div key={r.id} className="char-profile-rel-item">
                                  <div className="char-profile-rel-header">
                                    <span className="char-profile-rel-other">{other}</span>
                                    <span className="char-profile-rel-type">{relTypeLabel(t, r.type)}</span>
                                    {r.dynamic && <span className="char-profile-rel-dynamic">{relDynamicLabel(t, r.dynamic)}</span>}
                                    <button
                                      className="char-profile-rel-remove"
                                      onClick={() => deleteCharacterRelationship(r.id)}
                                      title={t('characters.removeRelationship')}
                                    >&times;</button>
                                  </div>
                                  {r.description && <div className="char-profile-rel-desc">{r.description}</div>}
                                </div>
                              );
                            })}
                            {rels.length === 0 && !isAdding && (
                              <div className="char-profile-rel-empty">{t('characters.noRelationships')}</div>
                            )}
                            {isAdding && (
                              <InlineRelForm
                                characterName={name}
                                allCharacters={allCharacters}
                                onSave={(rel) => {
                                  upsertCharacterRelationship(rel);
                                  setAddRelFor(null);
                                }}
                                onCancel={() => setAddRelFor(null)}
                              />
                            )}
                          </div>
                        );
                      })()}

                      {/* Scene appearances (collapsed by default) */}
                      {stats && stats.scenes.length > 0 && (
                        <details className="char-profile-scenes-collapsible">
                          <summary className="char-profile-label char-profile-scenes-toggle">
                            {t('characters.appearsIn', { count: stats.scenes.length })}
                          </summary>
                          <div className="char-profile-scene-chips">
                            {stats.scenes.map((s, i) => (
                              <span key={i} className="char-profile-scene-chip" onClick={() => handleNavigateToScene(s)} title={t('characters.goTo', { scene: s })}>{s}</span>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

      </div>

      {/* "Referred in Script" button at the bottom */}
      {unmatchedNames.length > 0 && (
        <button
          className="char-referred-btn"
          onClick={() => setShowReferred(true)}
        >
          {t('characters.referredButton', { n: unmatchedNames.length })}
        </button>
      )}

      {/* Referred in Script overlay panel */}
      {showReferred && (
        <div className="char-referred-overlay">
          <div className="char-referred-panel">
            <div className="char-referred-header">
              <span>{t('characters.referredTitle')}</span>
              <button className="char-profiles-close" onClick={() => setShowReferred(false)}>&times;</button>
            </div>
            <div className="char-referred-desc">
              {t('characters.referredHelp')}
            </div>
            <div className="char-referred-list">
              {unmatchedNames.map((name) => (
                <div key={name} className="char-unmatched-row">
                  <span className="char-unmatched-name">{name}</span>
                  <button
                    className="char-unmatched-add"
                    onClick={() => handleAddUnmatched(name)}
                    title={t('characters.addToList')}
                  >
                    {t('characters.addRelationship')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      </>}
      {/* End of profiles tab */}

      {/* Image Picker Overlay */}
      {imagePickerFor && (
        <div className="dialog-overlay" onClick={() => { setImagePickerFor(null); setImagePickerFilter(''); }}>
          <div className="dialog-box char-image-picker-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              {t('characters.selectImageFor', { name: imagePickerFor })}
              <button className="char-profiles-close" onClick={() => { setImagePickerFor(null); setImagePickerFilter(''); }}>&times;</button>
            </div>
            <div className="char-image-picker-search">
              <input
                type="text"
                placeholder={t('characters.placeholder.filterImages')}
                value={imagePickerFilter}
                onChange={(e) => setImagePickerFilter(e.target.value)}
                className="char-profiles-search-input"
                autoFocus
              />
            </div>
            <div className="char-image-picker-grid">
              {imageAssets.length === 0 ? (
                <div className="char-profiles-empty">{t('characters.noImageAssets')}</div>
              ) : (
                imageAssets
                  .filter((a) => !imagePickerFilter || a.original_name.toLowerCase().includes(imagePickerFilter.toLowerCase()))
                  .map((asset) => {
                    const alreadyLinked = (characterProfiles.find((p) => p.name === imagePickerFor)?.images || []).includes(asset.id);
                    return (
                      <div
                        key={asset.id}
                        className={`char-image-picker-item${alreadyLinked ? ' linked' : ''}`}
                        onClick={() => !alreadyLinked && handleAssociateAsset(imagePickerFor, asset.id)}
                        title={alreadyLinked ? t('characters.alreadyAssociated') : t('characters.associateNamed', { name: asset.original_name })}
                      >
                        <img src={getAssetUrl(asset.id)} alt={asset.original_name} />
                        <span className="char-image-picker-name">{asset.original_name}</span>
                        {alreadyLinked && <span className="char-image-picker-linked">{t('characters.linked')}</span>}
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Image Lightbox */}
      {lightboxImage && (
        <div className="dialog-overlay char-lightbox-overlay" onClick={() => setLightboxImage(null)}>
          <div className="char-lightbox" onClick={(e) => e.stopPropagation()}>
            <img src={lightboxImage.url} alt={lightboxImage.name} />
            <button className="char-lightbox-close" onClick={() => setLightboxImage(null)}>&times;</button>
          </div>
        </div>
      )}

      {/* Per-character enlarge modal */}
      {modalChar && (
        <div className="char-modal-overlay" onClick={() => setModalChar(null)}>
          <div className="char-modal-detail" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              {modalChar}
              <button className="char-profiles-close" onClick={() => setModalChar(null)}>&times;</button>
            </div>
            <div className="char-modal-body">
              {renderCharacterFields(modalChar, true)}
            </div>
          </div>
        </div>
      )}

      {pendingRemoveChar && (
        <div className="dialog-overlay" onClick={() => setPendingRemoveChar(null)}>
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
                  setPendingRemoveChar(null);
                }}
              >
                {t('common:remove')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CharacterProfiles;
