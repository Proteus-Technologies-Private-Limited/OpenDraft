import React from 'react';
import { useEditorStore } from '../stores/editorStore';
import { RETEXT_CATEGORIES, RETEXT_CATEGORY_META } from '../editor/grammar/retextProvider';
import { HARPER_CATEGORIES, HARPER_CATEGORY_META } from '../editor/grammar/harperProvider';

interface GrammarRulesPanelProps {
  onClose: () => void;
}

type Section = {
  title: string;
  blurb: string;
  ids: readonly string[];
  meta: Record<string, { label: string; severity: 'grammar' | 'style'; description: string }>;
};

const SECTIONS: Section[] = [
  {
    title: 'Grammar',
    blurb: 'Real grammar mistakes: agreement, tense, articles, capitalization, repeated words.',
    ids: HARPER_CATEGORIES,
    meta: HARPER_CATEGORY_META as Record<string, { label: string; severity: 'grammar' | 'style'; description: string }>,
  },
  {
    title: 'Style',
    blurb: 'Wordiness and tone suggestions (passive voice, weak intensifiers, "in order to").',
    ids: RETEXT_CATEGORIES,
    meta: RETEXT_CATEGORY_META as Record<string, { label: string; severity: 'grammar' | 'style'; description: string }>,
  },
];

const GrammarRulesPanel: React.FC<GrammarRulesPanelProps> = ({ onClose }) => {
  const grammarRulesEnabled = useEditorStore((s) => s.grammarRulesEnabled);
  const setGrammarRuleEnabled = useEditorStore((s) => s.setGrammarRuleEnabled);

  const isOn = (id: string) => grammarRulesEnabled[id] !== false;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520, minWidth: 420, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="dialog-header">Writing Suggestion Rules</div>
        <div className="dialog-body" style={{ overflowY: 'auto' }}>
          {SECTIONS.map((section) => (
            <div key={section.title} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{section.title}</div>
              <p style={{ fontSize: 12, color: 'var(--fd-text-muted)', marginTop: 0, marginBottom: 8 }}>
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
            </div>
          ))}
        </div>
        <div className="dialog-footer">
          <button className="dialog-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};

export default GrammarRulesPanel;
