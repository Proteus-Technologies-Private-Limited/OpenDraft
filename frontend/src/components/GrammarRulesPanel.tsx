import React from 'react';
import { useEditorStore } from '../stores/editorStore';
import { RETEXT_CATEGORIES, RETEXT_CATEGORY_META } from '../editor/grammar/retextProvider';

interface GrammarRulesPanelProps {
  onClose: () => void;
}

const GrammarRulesPanel: React.FC<GrammarRulesPanelProps> = ({ onClose }) => {
  const grammarRulesEnabled = useEditorStore((s) => s.grammarRulesEnabled);
  const setGrammarRuleEnabled = useEditorStore((s) => s.setGrammarRuleEnabled);

  const isOn = (id: string) => grammarRulesEnabled[id] !== false;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 460, minWidth: 380 }}
      >
        <div className="dialog-header">Writing Suggestion Rules</div>
        <div className="dialog-body">
          <p style={{ fontSize: 12, color: 'var(--fd-text-muted)', marginTop: 0 }}>
            Toggle the categories you want to see flagged while you write.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {RETEXT_CATEGORIES.map((id) => {
              const meta = RETEXT_CATEGORY_META[id];
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
        <div className="dialog-footer">
          <button className="dialog-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};

export default GrammarRulesPanel;
