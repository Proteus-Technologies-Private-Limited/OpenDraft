import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { spellChecker, PROJECT_DICT_TARGET } from '../editor/spellchecker';
import { BUILTIN, CATALOG, findLanguage } from '../editor/languageCatalog';

/** Subscribe to spellChecker.onChange so React re-renders when its state changes. */
function useSpellCheckerVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => spellChecker.onChange(() => setV((x) => x + 1)), []);
  return v;
}

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

const sectionTitleStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  marginBottom: 6,
};

const helpTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--fd-text-muted)',
};

/** Compact pill button showing whether a dictionary is a write target. */
const AddTargetToggle: React.FC<{ active: boolean; onToggle: () => void; disabled?: boolean }> = ({
  active,
  onToggle,
  disabled,
}) => (
  <button
    type="button"
    onClick={onToggle}
    disabled={disabled}
    title={active ? 'Add to Dictionary writes here' : 'Click to make this an Add-to-Dictionary target'}
    style={{
      padding: '3px 8px',
      borderRadius: 12,
      border: `1px solid ${active ? '#2e7dd7' : 'var(--fd-border)'}`,
      background: active ? 'rgba(46,125,215,0.15)' : 'transparent',
      color: active ? '#2e7dd7' : 'var(--fd-text-muted)',
      fontSize: 11,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      whiteSpace: 'nowrap',
    }}
  >
    {active ? '✓ Add here' : 'Add here'}
  </button>
);

// ─── Languages ─────────────────────────────────────────────────────────────

const LanguagesSection: React.FC<{ onOpenInstaller: () => void }> = ({ onOpenInstaller }) => {
  useSpellCheckerVersion();
  const installedLanguages = useEditorStore((s) => s.installedLanguages);
  const uninstallLanguage = useEditorStore((s) => s.uninstallLanguage);
  const loaded = spellChecker.getLoadedLanguages();
  const enabled = new Set(spellChecker.getEnabledLanguages());

  const toggle = (code: string, on: boolean) => {
    const current = spellChecker.getEnabledLanguages();
    const next = on
      ? Array.from(new Set([...current, code]))
      : current.filter((c) => c !== code);
    spellChecker.setEnabledLanguages(next);
  };

  const handleUninstall = async (code: string) => {
    const lang = findLanguage(code);
    const label = lang?.label || code;
    if (!window.confirm(`Remove "${label}" from this installation? You can re-download it any time.`)) return;
    await uninstallLanguage(code);
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={sectionTitleStyle}>Languages</div>
          <div style={helpTextStyle}>
            Hunspell engines that check words. Enable any combination for this script.
          </div>
        </div>
        <button type="button" onClick={onOpenInstaller} style={buttonStyle}>
          Add language…
        </button>
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {loaded.length === 0 && (
          <div style={helpTextStyle}>Loading built-in language…</div>
        )}
        {loaded.map(({ code, label }) => {
          const isBuiltin = code === BUILTIN.code;
          const isDownloaded = installedLanguages.includes(code);
          return (
            <label
              key={code}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 0',
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={enabled.has(code)}
                onChange={(e) => toggle(code, e.target.checked)}
              />
              <span style={{ flex: 1 }}>{label}</span>
              <span style={{ fontSize: 11, color: 'var(--fd-text-muted)' }}>
                {isBuiltin ? 'bundled' : isDownloaded ? 'installed' : 'loaded'}
              </span>
              {!isBuiltin && (
                <button
                  type="button"
                  onClick={() => handleUninstall(code)}
                  title="Remove this language"
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
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
};

// ─── Language installer dialog ─────────────────────────────────────────────

const LanguageInstallerDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useSpellCheckerVersion();
  const installedLanguages = useEditorStore((s) => s.installedLanguages);
  const installLanguage = useEditorStore((s) => s.installLanguage);
  const installLanguageFromUrls = useEditorStore((s) => s.installLanguageFromUrls);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [customAff, setCustomAff] = useState('');
  const [customDic, setCustomDic] = useState('');

  // Recomputed every render — useSpellCheckerVersion above forces a re-render
  // whenever a language is installed/removed, so this stays current.
  const loadedCodes = new Set(spellChecker.getLoadedLanguages().map((l) => l.code));

  const filtered = CATALOG.filter((l) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return l.label.toLowerCase().includes(q) || l.code.toLowerCase().includes(q);
  });

  const handleInstall = async (code: string) => {
    setBusy(code);
    setError(null);
    try {
      const res = await installLanguage(code);
      if (!res.ok) setError(res.error || 'Install failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleInstallCustom = async () => {
    const code = customCode.trim();
    if (!code) {
      setError('Language code is required (e.g. hi_IN).');
      return;
    }
    setBusy('__custom__');
    setError(null);
    try {
      const res = await installLanguageFromUrls({
        code,
        label: customLabel.trim() || code,
        affUrl: customAff.trim(),
        dicUrl: customDic.trim(),
      });
      if (!res.ok) {
        setError(res.error || 'Install failed.');
      } else {
        setCustomCode('');
        setCustomLabel('');
        setCustomAff('');
        setCustomDic('');
        setCustomOpen(false);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560, minWidth: 440, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="dialog-header">Add Language</div>
        <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
          <div style={helpTextStyle}>
            Languages are downloaded from jsdelivr (wooorm/dictionaries) or
            the LibreOffice dictionaries repo on GitHub, and cached locally.
            A network connection is required for the first install.
          </div>
          <input
            type="text"
            placeholder="Search languages…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ ...inputStyle, flex: '0 0 auto' }}
          />
          {error && (
            <div
              style={{
                padding: '6px 10px',
                background: 'rgba(192,57,43,0.12)',
                color: '#c0392b',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              border: '1px solid var(--fd-border)',
              borderRadius: 4,
              minHeight: 240,
              maxHeight: 360,
            }}
          >
            {filtered.length === 0 && (
              <div style={{ padding: 12, ...helpTextStyle }}>No matches.</div>
            )}
            {filtered.map((lang) => {
              const isInstalled = loadedCodes.has(lang.code) || installedLanguages.includes(lang.code);
              const isBusy = busy === lang.code;
              return (
                <div
                  key={lang.code}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--fd-border)',
                    fontSize: 13,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {lang.label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--fd-text-muted)' }}>
                      {lang.code} · {
                        lang.source.kind === 'jsdelivr'
                          ? lang.source.npm
                          : lang.source.kind === 'libreoffice'
                            ? `LibreOffice/${lang.source.folder}`
                            : `OpenDraft/${lang.source.path}`
                      }
                    </div>
                  </div>
                  {lang.sample && (
                    <div style={{ fontSize: 16, color: 'var(--fd-text-muted)', padding: '0 8px' }}>
                      {lang.sample}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleInstall(lang.code)}
                    disabled={isInstalled || isBusy}
                    style={{
                      ...buttonStyle,
                      minWidth: 90,
                      opacity: isInstalled ? 0.5 : 1,
                      cursor: isInstalled || isBusy ? 'default' : 'pointer',
                    }}
                  >
                    {isInstalled ? 'Installed' : isBusy ? 'Installing…' : 'Install'}
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ borderTop: '1px solid var(--fd-border)', paddingTop: 10 }}>
            <button
              type="button"
              onClick={() => setCustomOpen((v) => !v)}
              style={{
                ...buttonStyle,
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                fontSize: 13,
              }}
            >
              {customOpen ? '▾' : '▸'} Install from custom URL (e.g. Hindi, Tamil, etc.)
            </button>
            {customOpen && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={helpTextStyle}>
                  Paste links to a Hunspell `.aff` and `.dic` file. The pair will be downloaded and cached locally.
                </div>
                <input
                  type="text"
                  placeholder="Language code (e.g. hi_IN)"
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value)}
                  style={{ ...inputStyle, flex: '0 0 auto' }}
                />
                <input
                  type="text"
                  placeholder="Display name (e.g. Hindi)"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  style={{ ...inputStyle, flex: '0 0 auto' }}
                />
                <input
                  type="text"
                  placeholder=".aff URL"
                  value={customAff}
                  onChange={(e) => setCustomAff(e.target.value)}
                  style={{ ...inputStyle, flex: '0 0 auto' }}
                />
                <input
                  type="text"
                  placeholder=".dic URL"
                  value={customDic}
                  onChange={(e) => setCustomDic(e.target.value)}
                  style={{ ...inputStyle, flex: '0 0 auto' }}
                />
                <button
                  type="button"
                  onClick={handleInstallCustom}
                  disabled={busy === '__custom__'}
                  style={{ ...buttonStyle, alignSelf: 'flex-end' }}
                >
                  {busy === '__custom__' ? 'Installing…' : 'Install'}
                </button>
              </div>
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

// ─── Project dictionary ────────────────────────────────────────────────────

const ProjectDictionarySection: React.FC = () => {
  useSpellCheckerVersion();
  const addTargets = useEditorStore((s) => s.addTargets);
  const setAddTargets = useEditorStore((s) => s.setAddTargets);
  const projectWords = spellChecker.getProjectWords();
  const projectEnabled = spellChecker.isProjectDictionaryEnabled();
  const [newWord, setNewWord] = useState('');
  const [expanded, setExpanded] = useState(false);

  const handleAdd = () => {
    const w = newWord.trim();
    if (!w) return;
    spellChecker.addToProjectDictionary(w);
    setNewWord('');
  };

  const toggleEnabled = (on: boolean) => {
    spellChecker.setProjectDictionaryEnabled(on);
  };

  const toggleAddTarget = () => {
    const has = addTargets.includes(PROJECT_DICT_TARGET);
    const next = has
      ? addTargets.filter((t) => t !== PROJECT_DICT_TARGET)
      : [...addTargets, PROJECT_DICT_TARGET];
    setAddTargets(next);
  };

  const isAddTarget = addTargets.includes(PROJECT_DICT_TARGET);

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={projectEnabled}
            onChange={(e) => toggleEnabled(e.target.checked)}
          />
          <div style={{ flex: 1 }}>
            <div style={sectionTitleStyle}>Project dictionary</div>
            <div style={helpTextStyle}>
              {projectEnabled
                ? projectWords.length === 0
                  ? 'No words yet — anything you "Add to Dictionary" goes here by default.'
                  : `${projectWords.length} word${projectWords.length === 1 ? '' : 's'}. Saved with this script.`
                : 'Disabled for this project — checks skip these words and "Add to Dictionary" routes to globals only.'}
            </div>
          </div>
        </label>
        <AddTargetToggle
          active={isAddTarget && projectEnabled}
          disabled={!projectEnabled}
          onToggle={toggleAddTarget}
        />
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
              disabled={!projectEnabled}
            />
            <button type="button" onClick={handleAdd} style={buttonStyle} disabled={!projectEnabled}>
              Add
            </button>
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
                  style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', fontSize: 13 }}
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

// ─── Global dictionaries ───────────────────────────────────────────────────

const GlobalDictionariesSection: React.FC<{ onOpenLibrary: () => void }> = ({ onOpenLibrary }) => {
  useSpellCheckerVersion();
  const customDictionaries = useEditorStore((s) => s.customDictionaries);
  const addTargets = useEditorStore((s) => s.addTargets);
  const setAddTargets = useEditorStore((s) => s.setAddTargets);
  const names = Object.keys(customDictionaries).sort();
  const enabled = new Set(spellChecker.getEnabledGlobalDicts());

  const toggleEnabled = (name: string, on: boolean) => {
    const current = spellChecker.getEnabledGlobalDicts();
    const next = on ? Array.from(new Set([...current, name])) : current.filter((n) => n !== name);
    spellChecker.setEnabledGlobalDicts(next);
  };

  const toggleAddTarget = (name: string) => {
    const has = addTargets.includes(name);
    const next = has ? addTargets.filter((t) => t !== name) : [...addTargets, name];
    setAddTargets(next);
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={sectionTitleStyle}>Global dictionaries</div>
          <div style={helpTextStyle}>
            Reusable word lists shared across projects. Enable any combination for this script.
          </div>
        </div>
        <button type="button" onClick={onOpenLibrary} style={buttonStyle}>Manage library…</button>
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {names.length === 0 && (
          <div style={helpTextStyle}>
            No global dictionaries yet. Click "Manage library…" to create one.
          </div>
        )}
        {names.map((name) => (
          <div
            key={name}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', minWidth: 0 }}>
              <input
                type="checkbox"
                checked={enabled.has(name)}
                onChange={(e) => toggleEnabled(name, e.target.checked)}
              />
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {name}
              </span>
              <span style={{ fontSize: 11, color: 'var(--fd-text-muted)' }}>
                {customDictionaries[name].length} word{customDictionaries[name].length === 1 ? '' : 's'}
              </span>
            </label>
            <AddTargetToggle
              active={addTargets.includes(name) && enabled.has(name)}
              disabled={!enabled.has(name)}
              onToggle={() => toggleAddTarget(name)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Settings ──────────────────────────────────────────────────────────────

const SpellingSettings: React.FC = () => {
  const spellingSettings = useEditorStore((s) => s.spellingSettings);
  const setSpellingSetting = useEditorStore((s) => s.setSpellingSetting);

  return (
    <div style={cardStyle}>
      <label
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}
      >
        <input
          type="checkbox"
          checked={spellingSettings.flagProperNouns}
          onChange={(e) => setSpellingSetting('flagProperNouns', e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <div style={{ flex: 1 }}>
          <div style={sectionTitleStyle}>Flag proper nouns</div>
          <div style={helpTextStyle}>
            When off, capitalized unknown words (names, places, brands) are not flagged.
            Turn on for stricter checking — real proper nouns will then need to be added to a dictionary.
          </div>
        </div>
      </label>
    </div>
  );
};

// ─── Top-level panel ───────────────────────────────────────────────────────

const DictionaryConfigPanel: React.FC<{ onOpenLibrary: () => void }> = ({ onOpenLibrary }) => {
  const [installerOpen, setInstallerOpen] = useState(false);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 12, color: 'var(--fd-text-muted)', marginTop: 0, marginBottom: 0 }}>
          Configure which dictionaries are active for this script and where
          "Add to Dictionary" sends new words.
        </p>
        <LanguagesSection onOpenInstaller={() => setInstallerOpen(true)} />
        <ProjectDictionarySection />
        <GlobalDictionariesSection onOpenLibrary={onOpenLibrary} />
        <SpellingSettings />
      </div>
      {installerOpen && <LanguageInstallerDialog onClose={() => setInstallerOpen(false)} />}
    </>
  );
};

export default DictionaryConfigPanel;
