import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorStore, type CharacterProfile } from '../stores/editorStore';

// Default colors for auto-assignment (Final Draft typical palette)
const DEFAULT_HIGHLIGHT_COLORS = [
  '#e06060', '#6fa8dc', '#6abf69', '#f4d35e', '#e89b4f',
  '#b58ee0', '#e06c9f', '#5bb8a9', '#c4a35a', '#7a9fd4',
  '#d47a7a', '#79c279',
];

interface CharacterProfilesProps {
  editor: Editor | null;
}

const CharacterProfiles: React.FC<CharacterProfilesProps> = ({ editor }) => {
  const {
    characters,
    characterProfiles,
    upsertCharacterProfile,
    deleteCharacterProfile,
    characterProfilesOpen,
    toggleCharacterProfiles,
  } = useEditorStore();

  const [expandedChar, setExpandedChar] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showReferred, setShowReferred] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'importance' | 'scenes' | 'dialogues' | 'appearance'>('name');
  const [pendingRemoveChar, setPendingRemoveChar] = useState<string | null>(null);
  const descriptionRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

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
        const base = node.textContent.trim().replace(/\s*\([^)]*\)\s*/g, '').toUpperCase();
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

    // Step 3: apply to profiles
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
  }, [editor, characterProfiles, upsertCharacterProfile]);

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
        currentScene = node.textContent.trim();
      }
      if (node.type.name === 'character') {
        currentChar = node.textContent.trim().replace(/\s*\([^)]*\)\s*/g, '').toUpperCase();
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
          const base = node.textContent.trim().replace(/\s*\([^)]*\)\s*/g, '').toUpperCase();
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
          editorMain.scrollTo({ top: scrollTo, behavior: 'smooth' });
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
  const orphanedNames = useMemo(() => {
    const scriptNames = new Set(characters.map((c) => c.toUpperCase()));
    return new Set(
      characterProfiles
        .filter((p) => !scriptNames.has(p.name))
        .map((p) => p.name),
    );
  }, [characters, characterProfiles]);

  // All characters (from profiles + auto-detected), sorted by selected criteria
  const allCharacters = useMemo(() => {
    const nameSet = new Set<string>();
    for (const p of characterProfiles) nameSet.add(p.name);
    for (const c of characters) nameSet.add(c.toUpperCase());
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
          return a.localeCompare(b);
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
  }, [characterProfiles, characters, searchQuery, sortBy, charStats]);

  const getProfile = useCallback(
    (name: string): CharacterProfile => {
      const existing = characterProfiles.find((p) => p.name === name);
      if (existing) return existing;
      return { name, description: '', color: '', highlighted: false, gender: '', age: '' };
    },
    [characterProfiles],
  );

  if (!characterProfilesOpen) return null;

  return (
    <div className="char-profiles-panel">
      <div className="char-profiles-header">
        <span className="char-profiles-title">Characters</span>
        <span className="char-profiles-count">{allCharacters.length}</span>
        <button className="char-profiles-close" onClick={toggleCharacterProfiles} title="Close">
          &times;
        </button>
      </div>

      {/* Toolbar: Search + Build */}
      <div className="char-profiles-toolbar">
        <input
          type="text"
          placeholder="Search characters..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="char-profiles-search-input"
        />
        <button
          className="char-profiles-build-btn"
          onClick={handleBuildFromScript}
          title="Scan the screenplay for characters and extract descriptions from action lines"
        >
          Build from Script
        </button>
      </div>
      {/* Sort bar */}
      <div className="char-profiles-sort">
        <span className="char-sort-label">Sort</span>
        <select
          className="char-sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
        >
          <option value="name">Name</option>
          <option value="importance">Importance</option>
          <option value="scenes">Scenes</option>
          <option value="dialogues">Dialogues</option>
          <option value="appearance">Appearance</option>
        </select>
      </div>

      {/* Character list */}
      <div className="char-profiles-list">
        {allCharacters.length === 0 ? (
          <div className="char-profiles-empty">
            {searchQuery
              ? 'No characters match your search.'
              : 'No characters detected. Add character elements to your screenplay.'}
          </div>
        ) : (
          allCharacters.map((name) => {
            const profile = getProfile(name);
            const stats = charStats.get(name);
            const isExpanded = expandedChar === name;
            const isOrphaned = orphanedNames.has(name);

            return (
              <div key={name} className={`char-profile-card${isOrphaned ? ' char-orphaned' : ''}`}>
                {/* Orphaned banner */}
                {isOrphaned && (
                  <div className="char-orphaned-banner">
                    <span>Not in script</span>
                    <button
                      className="char-orphaned-remove"
                      onClick={() => setPendingRemoveChar(name)}
                    >
                      Remove
                    </button>
                  </div>
                )}
                {/* Header row */}
                <div
                  className="char-profile-row"
                  onClick={() => setExpandedChar(isExpanded ? null : name)}
                >
                  {/* Color swatch */}
                  <input
                    type="color"
                    className="char-profile-color"
                    value={profile.color || '#999999'}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => upsertCharacterProfile(name, { color: e.target.value })}
                    title="Highlight color"
                  />
                  <div className="char-profile-name-col">
                    <span
                      className="char-profile-name"
                      onClick={(e) => { e.stopPropagation(); handleNavigateToCharacter(name); }}
                      title="Click to navigate to first appearance"
                    >
                      {name}
                    </span>
                    {profile.description && !isExpanded && (
                      <span className="char-profile-desc-preview">
                        {profile.description.slice(0, 50)}{profile.description.length > 50 ? '...' : ''}
                      </span>
                    )}
                  </div>
                  <div className="char-profile-stats">
                    {stats && (
                      <>
                        <span title={`${stats.dialogueCount} dialogue lines`}>{stats.dialogueCount} lines</span>
                        <span title={`In ${stats.sceneCount} scenes`}>{stats.sceneCount} scenes</span>
                      </>
                    )}
                  </div>
                  <span className={`char-profile-chevron${isExpanded ? ' expanded' : ''}`}>&#9662;</span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="char-profile-detail">
                    {/* Description */}
                    <label className="char-profile-label">Description</label>
                    <textarea
                      ref={(el) => { if (el) descriptionRefs.current.set(name, el); }}
                      className="char-profile-textarea"
                      value={profile.description}
                      onChange={(e) => upsertCharacterProfile(name, { description: e.target.value })}
                      placeholder="A weary detective in his 50s, haunted by a cold case..."
                      rows={3}
                    />

                    {/* Gender / Age */}
                    <div className="char-profile-meta-row">
                      <div className="char-profile-meta-field">
                        <label className="char-profile-label">Gender</label>
                        <input
                          type="text"
                          className="char-profile-input"
                          value={profile.gender}
                          onChange={(e) => upsertCharacterProfile(name, { gender: e.target.value })}
                          placeholder="e.g. Male, Female, Non-binary"
                        />
                      </div>
                      <div className="char-profile-meta-field">
                        <label className="char-profile-label">Age</label>
                        <input
                          type="text"
                          className="char-profile-input"
                          value={profile.age}
                          onChange={(e) => upsertCharacterProfile(name, { age: e.target.value })}
                          placeholder="e.g. 30s, 45"
                        />
                      </div>
                    </div>

                    {/* Highlight toggle */}
                    <div className="char-profile-highlight-row">
                      <label className="char-profile-label">Highlight in script</label>
                      <button
                        className={`char-profile-highlight-btn${profile.highlighted ? ' active' : ''}`}
                        onClick={() => upsertCharacterProfile(name, { highlighted: !profile.highlighted })}
                        style={profile.highlighted ? { background: profile.color || '#999', borderColor: profile.color || '#999' } : undefined}
                      >
                        {profile.highlighted ? 'On' : 'Off'}
                      </button>
                    </div>

                    {/* Scene appearances */}
                    {stats && stats.scenes.length > 0 && (
                      <div className="char-profile-scenes">
                        <label className="char-profile-label">Appears in</label>
                        <div className="char-profile-scene-chips">
                          {stats.scenes.map((s, i) => (
                            <span key={i} className="char-profile-scene-chip">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
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
          Referred in Script ({unmatchedNames.length})
        </button>
      )}

      {/* Referred in Script overlay panel */}
      {showReferred && (
        <div className="char-referred-overlay">
          <div className="char-referred-panel">
            <div className="char-referred-header">
              <span>Referred in Script</span>
              <button className="char-profiles-close" onClick={() => setShowReferred(false)}>&times;</button>
            </div>
            <div className="char-referred-desc">
              Names found in ALL CAPS in action lines that are not yet in the character list.
            </div>
            <div className="char-referred-list">
              {unmatchedNames.map((name) => (
                <div key={name} className="char-unmatched-row">
                  <span className="char-unmatched-name">{name}</span>
                  <button
                    className="char-unmatched-add"
                    onClick={() => handleAddUnmatched(name)}
                    title="Add to character list"
                  >
                    + Add
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {pendingRemoveChar && (
        <div className="dialog-overlay" onClick={() => setPendingRemoveChar(null)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Remove Character</div>
            <div className="dialog-body">
              <p style={{ margin: 0 }}>Remove &ldquo;{pendingRemoveChar}&rdquo; from the character list?</p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setPendingRemoveChar(null)}>Cancel</button>
              <button
                className="dialog-primary"
                style={{ background: '#c0392b' }}
                onClick={() => {
                  deleteCharacterProfile(pendingRemoveChar);
                  setPendingRemoveChar(null);
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CharacterProfiles;
