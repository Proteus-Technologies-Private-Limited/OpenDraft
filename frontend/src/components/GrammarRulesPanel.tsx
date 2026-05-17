import React, { useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { RETEXT_CATEGORIES, RETEXT_CATEGORY_META } from '../editor/grammar/retextProvider';
import { HARPER_CATEGORIES, HARPER_CATEGORY_META } from '../editor/grammar/harperProvider';
import DictionaryLibrary from './DictionaryLibrary';
import DictionaryConfigPanel from './DictionaryConfigPanel';

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

type TabId = 'grammar' | 'style' | 'dictionaries';
const TABS: { id: TabId; label: string }[] = [
  { id: 'grammar', label: 'Grammar' },
  { id: 'style', label: 'Style' },
  { id: 'dictionaries', label: 'Dictionaries' },
];

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
          style={{ maxWidth: 640, minWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
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
            {activeTab === 'dictionaries' && (
              <DictionaryConfigPanel onOpenLibrary={() => setDictionaryLibraryOpen(true)} />
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
