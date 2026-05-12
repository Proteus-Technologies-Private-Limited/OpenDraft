import React, { useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../stores/editorStore';

interface DictionaryLibraryProps {
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '6px 8px',
  border: '1px solid var(--fd-border)',
  borderRadius: 4,
  background: 'var(--fd-bg)',
  color: 'var(--fd-text)',
  fontSize: 13,
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

const DictionaryLibrary: React.FC<DictionaryLibraryProps> = ({ onClose }) => {
  const customDictionaries = useEditorStore((s) => s.customDictionaries);
  const createGlobalDictionary = useEditorStore((s) => s.createGlobalDictionary);
  const renameGlobalDictionary = useEditorStore((s) => s.renameGlobalDictionary);
  const deleteGlobalDictionary = useEditorStore((s) => s.deleteGlobalDictionary);
  const setGlobalDictionaryWords = useEditorStore((s) => s.setGlobalDictionaryWords);

  const names = useMemo(() => Object.keys(customDictionaries).sort(), [customDictionaries]);
  const [selected, setSelected] = useState<string | null>(names[0] ?? null);
  const [newDictName, setNewDictName] = useState('');
  const [newWord, setNewWord] = useState('');
  const wordInputRef = useRef<HTMLInputElement>(null);

  // Keep `selected` valid as the library mutates.
  React.useEffect(() => {
    if (selected && !customDictionaries[selected]) {
      setSelected(names[0] ?? null);
    } else if (!selected && names.length > 0) {
      setSelected(names[0]);
    }
  }, [customDictionaries, names, selected]);

  const handleCreate = () => {
    const name = newDictName.trim();
    if (!name) return;
    if (customDictionaries[name]) return;
    createGlobalDictionary(name);
    setNewDictName('');
    setSelected(name);
  };

  const handleRename = (oldName: string) => {
    const next = window.prompt('Rename dictionary', oldName);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === oldName) return;
    if (customDictionaries[trimmed]) {
      window.alert(`A dictionary named "${trimmed}" already exists.`);
      return;
    }
    renameGlobalDictionary(oldName, trimmed);
    setSelected(trimmed);
  };

  const handleDelete = (name: string) => {
    if (!window.confirm(`Delete dictionary "${name}"? This cannot be undone.`)) return;
    deleteGlobalDictionary(name);
  };

  const handleAddWord = () => {
    if (!selected) return;
    const word = newWord.trim();
    if (!word) return;
    const current = customDictionaries[selected] ?? [];
    if (current.some((w) => w.toLowerCase() === word.toLowerCase())) {
      setNewWord('');
      return;
    }
    setGlobalDictionaryWords(selected, [...current, word]);
    setNewWord('');
    wordInputRef.current?.focus();
  };

  const handleRemoveWord = (word: string) => {
    if (!selected) return;
    const current = customDictionaries[selected] ?? [];
    setGlobalDictionaryWords(selected, current.filter((w) => w !== word));
  };

  const selectedWords = selected ? customDictionaries[selected] ?? [] : [];

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 720, minWidth: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="dialog-header">Dictionary Library</div>
        <div className="dialog-body" style={{ display: 'flex', gap: 12, padding: 16, overflow: 'hidden', flex: 1, minHeight: 360 }}>
          {/* Left column: list of dictionaries */}
          <div style={{ flex: '0 0 220px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--fd-border)', paddingRight: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Dictionaries</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <input
                type="text"
                placeholder="New dictionary"
                value={newDictName}
                onChange={(e) => setNewDictName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                style={inputStyle}
              />
              <button type="button" onClick={handleCreate} style={buttonStyle}>Add</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {names.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--fd-text-muted)', padding: 8 }}>
                  No dictionaries yet. Create one above.
                </div>
              )}
              {names.map((name) => {
                const active = name === selected;
                return (
                  <div
                    key={name}
                    onClick={() => setSelected(name)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 8px',
                      borderRadius: 4,
                      background: active ? 'var(--fd-accent-bg, rgba(46,125,215,0.12))' : 'transparent',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {name}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--fd-text-muted)' }}>
                      {(customDictionaries[name] ?? []).length}
                    </span>
                  </div>
                );
              })}
            </div>
            {selected && (
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button type="button" onClick={() => handleRename(selected)} style={buttonStyle}>Rename</button>
                <button
                  type="button"
                  onClick={() => handleDelete(selected)}
                  style={{ ...buttonStyle, color: '#c0392b', borderColor: '#c0392b' }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>

          {/* Right column: word list of selected dictionary */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {!selected ? (
              <div style={{ fontSize: 13, color: 'var(--fd-text-muted)', padding: 16 }}>
                Select or create a dictionary to manage its words.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                  Words in “{selected}” ({selectedWords.length})
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <input
                    ref={wordInputRef}
                    type="text"
                    placeholder="Add a word"
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddWord(); }}
                    style={inputStyle}
                  />
                  <button type="button" onClick={handleAddWord} style={buttonStyle}>Add</button>
                </div>
                <div
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    border: '1px solid var(--fd-border)',
                    borderRadius: 4,
                    padding: 4,
                    minHeight: 0,
                  }}
                >
                  {selectedWords.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--fd-text-muted)', padding: 8 }}>
                      No words yet.
                    </div>
                  ) : (
                    selectedWords.map((w) => (
                      <div
                        key={w}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '4px 8px',
                          fontSize: 13,
                          borderRadius: 3,
                        }}
                      >
                        <span style={{ flex: 1 }}>{w}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveWord(w)}
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
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="dialog-footer">
          <button className="dialog-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};

export default DictionaryLibrary;
