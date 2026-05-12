import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { spellChecker } from '../editor/spellchecker';
import { RETEXT_CATEGORIES, RETEXT_CATEGORY_META } from '../editor/grammar/retextProvider';
import { HARPER_CATEGORIES, HARPER_CATEGORY_META } from '../editor/grammar/harperProvider';
import DictionaryLibrary from './DictionaryLibrary';

interface GrammarRulesPanelProps {
  onClose: () => void;
}

type RuleSection = {
  blurb: string;
  ids: readonly string[];
  meta: Record<string, { label: string; severity: 'grammar' | 'style'; description: string }>;
};

const GRAMMAR_SECTION: RuleSection = {
  blurb: 'Real grammar mistakes: agreement, tense, articles, capitalization, repeated words.',
  ids: HARPER_CATEGORIES,
  meta: HARPER_CATEGORY_META as Record<string, { label: string; severity: 'grammar' | 'style'; description: string }>,
};

const STYLE_SECTION: RuleSection = {
  blurb: 'Wordiness and tone suggestions (passive voice, weak intensifiers, "in order to").',
  ids: RETEXT_CATEGORIES,
  meta: RETEXT_CATEGORY_META as Record<string, { label: string; severity: 'grammar' | 'style'; description: string }>,
};

type TabId = 'grammar' | 'style' | 'spelling';
const TABS: { id: TabId; label: string }[] = [
  { id: 'grammar', label: 'Grammar' },
  { id: 'style', label: 'Style' },
  { id: 'spelling', label: 'Spelling' },
];

const cardStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid var(--fd-border)',
  borderRadius: 6,
};

const buttonStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--fd-border)',
  borderRadius: 4,
  background: 'var(--fd-bg)',
  color: 'var(--fd-text)',
  fontSize: 12,
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '6px 8px',
  border: '1px solid var(--fd-border)',
  borderRadius: 4,
  background: 'var(--fd-bg)',
  color: 'var(--fd-text)',
  fontSize: 13,
};

/** Subscribe to spellChecker.onChange so React re-renders when its state changes. */
function useSpellCheckerVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => spellChecker.onChange(() => setV((x) => x + 1)), []);
  return v;
}

const RuleList: React.FC<{ section: RuleSection }> = ({ section }) => {
  const grammarRulesEnabled = useEditorStore((s) => s.grammarRulesEnabled);
  const setGrammarRuleEnabled = useEditorStore((s) => s.setGrammarRuleEnabled);
  const isOn = (id: string) => grammarRulesEnabled[id] !== false;

  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--fd-text-muted)', marginTop: 0, marginBottom: 12 }}>
        {section.blurb}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {section.ids.map((id) => {
          const meta = section.meta[id];
          if (!meta) return null;
          return (
            <label
              key={id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '8px 10px',
                border: '1px solid var(--fd-border)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={isOn(id)}
                onChange={(e) => setGrammarRuleEnabled(id, e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{meta.label}</div>
                <div style={{ fontSize: 12, color: 'var(--fd-text-muted)' }}>{meta.description}</div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: meta.severity === 'grammar' ? 'rgba(26,168,136,0.15)' : 'rgba(46,125,215,0.15)',
                  color: meta.severity === 'grammar' ? '#1aa888' : '#2e7dd7',
                }}
              >
                {meta.severity}
              </span>
            </label>
          );
        })}
      </div>
    </>
  );
};

const ProjectDictionarySection: React.FC = () => {
  useSpellCheckerVersion();
  const projectWords = spellChecker.getProjectWords();
  const [newWord, setNewWord] = useState('');
  const [expanded, setExpanded] = useState(false);

  const handleAdd = () => {
    const w = newWord.trim();
    if (!w) return;
    spellChecker.addToProjectDictionary(w);
    setNewWord('');
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>This project's dictionary</div>
          <div style={{ fontSize: 12, color: 'var(--fd-text-muted)' }}>
            {projectWords.length === 0
              ? 'No words yet — anything you add to dictionary from the spell-check menu goes here.'
              : `${projectWords.length} word${projectWords.length === 1 ? '' : 's'}. Saved with the script.`}
          </div>
        </div>
        <button type="button" onClick={() => setExpanded((x) => !x)} style={buttonStyle}>
          {expanded ? 'Hide' : 'Edit words…'}
        </button>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              placeholder="Add a word"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              style={inputStyle}
            />
            <button type="button" onClick={handleAdd} style={buttonStyle}>Add</button>
          </div>
          {projectWords.length > 0 && (
            <div
              style={{
                maxHeight: 200,
                overflowY: 'auto',
                border: '1px solid var(--fd-border)',
                borderRadius: 4,
                padding: 4,
              }}
            >
              {projectWords.map((w) => (
                <div
                  key={w}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px 8px',
                    fontSize: 13,
                  }}
                >
                  <span style={{ flex: 1 }}>{w}</span>
                  <button
                    type="button"
                    onClick={() => spellChecker.removeFromProjectDictionary(w)}
                    title="Remove"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--fd-text-muted)',
                      cursor: 'pointer',
                      fontSize: 14,
                      padding: '0 4px',
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const GlobalDictionariesSection: React.FC<{ onOpenLibrary: () => void }> = ({ onOpenLibrary }) => {
  useSpellCheckerVersion();
  const customDictionaries = useEditorStore((s) => s.customDictionaries);
  const names = Object.keys(customDictionaries).sort();
  const enabled = new Set(spellChecker.getEnabledGlobalDicts());

  const toggle = (name: string, on: boolean) => {
    const current = spellChecker.getEnabledGlobalDicts();
    const next = on ? Array.from(new Set([...current, name])) : current.filter((n) => n !== name);
    spellChecker.setEnabledGlobalDicts(next);
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>Global dictionaries</div>
          <div style={{ fontSize: 12, color: 'var(--fd-text-muted)' }}>
            Reusable word lists shared across projects. Enable any combination for this script.
          </div>
        </div>
        <button type="button" onClick={onOpenLibrary} style={buttonStyle}>Manage library…</button>
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {names.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--fd-text-muted)' }}>
            No global dictionaries yet. Click "Manage library…" to create one.
          </div>
        )}
        {names.map((name) => (
          <label
            key={name}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}
          >
            <input
              type="checkbox"
              checked={enabled.has(name)}
              onChange={(e) => toggle(name, e.target.checked)}
            />
            <span style={{ flex: 1 }}>{name}</span>
            <span style={{ fontSize: 11, color: 'var(--fd-text-muted)' }}>
              {customDictionaries[name].length} word{customDictionaries[name].length === 1 ? '' : 's'}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
};

const SpellingTab: React.FC<{ onOpenLibrary: () => void }> = ({ onOpenLibrary }) => {
  const spellingSettings = useEditorStore((s) => s.spellingSettings);
  const setSpellingSetting = useEditorStore((s) => s.setSpellingSetting);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: 'var(--fd-text-muted)', marginTop: 0, marginBottom: 0 }}>
        Settings for the dictionary-based spell checker.
      </p>

      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '8px 10px',
          border: '1px solid var(--fd-border)',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={spellingSettings.flagProperNouns}
          onChange={(e) => setSpellingSetting('flagProperNouns', e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>Flag proper nouns</div>
          <div style={{ fontSize: 12, color: 'var(--fd-text-muted)' }}>
            When off, capitalized unknown words (names, places, brands) are not flagged. Turn on
            for stricter checking — real proper nouns will then need to be added to a dictionary.
          </div>
        </div>
      </label>

      <ProjectDictionarySection />
      <GlobalDictionariesSection onOpenLibrary={onOpenLibrary} />
    </div>
  );
};

const GrammarRulesPanel: React.FC<GrammarRulesPanelProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<TabId>('grammar');
  const dictionaryLibraryOpen = useEditorStore((s) => s.dictionaryLibraryOpen);
  const setDictionaryLibraryOpen = useEditorStore((s) => s.setDictionaryLibraryOpen);

  return (
    <>
      <div className="dialog-overlay" onClick={onClose}>
        <div
          className="dialog-box"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: 600, minWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        >
          <div className="dialog-header">Grammar &amp; Spelling Settings</div>
          <div
            style={{
              display: 'flex',
              gap: 4,
              borderBottom: '1px solid var(--fd-border)',
              padding: '0 16px',
            }}
          >
            {TABS.map((t) => {
              const active = t.id === activeTab;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '8px 12px',
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    color: active ? 'var(--fd-text)' : 'var(--fd-text-muted)',
                    borderBottom: active ? '2px solid var(--fd-accent, #2e7dd7)' : '2px solid transparent',
                    cursor: 'pointer',
                    marginBottom: -1,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="dialog-body" style={{ overflowY: 'auto' }}>
            {activeTab === 'grammar' && <RuleList section={GRAMMAR_SECTION} />}
            {activeTab === 'style' && <RuleList section={STYLE_SECTION} />}
            {activeTab === 'spelling' && (
              <SpellingTab onOpenLibrary={() => setDictionaryLibraryOpen(true)} />
            )}
          </div>
          <div className="dialog-footer">
            <button className="dialog-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
      {dictionaryLibraryOpen && (
        <DictionaryLibrary onClose={() => setDictionaryLibraryOpen(false)} />
      )}
    </>
  );
};

export default GrammarRulesPanel;
