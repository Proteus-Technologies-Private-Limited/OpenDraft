import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../stores/editorStore';
import { characterKey } from '../utils/nodeText';
import { applyCharacterRename, findCharacterRenameMatches } from '../editor/characterRename';
import { showToast } from './Toast';
import { elementLabel } from '../editor/elementLabels';

interface RenameCharacterDialogProps {
  editor: Editor;
  /** Canonical (uppercase, extension-free) name of the character being renamed. */
  name: string;
  onClose: () => void;
}

/**
 * Rename a character everywhere: every cue (keeping `(V.O.)`, `(CONT'D)` …),
 * the profile, relationships and Cast tags, plus — reviewed one by one — the
 * name where it appears in action, dialogue and headings. One undo step.
 */
const RenameCharacterDialog: React.FC<RenameCharacterDialogProps> = ({ editor, name, onClose }) => {
  const { t } = useTranslation(['tools', 'common']);
  const [newName, setNewName] = useState(name);
  const [includeMentions, setIncludeMentions] = useState(true);
  // Indexes of mentions the writer unticked. The old name fixes where the
  // mentions are, so these survive edits to the new name.
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const renameCharacter = useEditorStore((s) => s.renameCharacter);
  const profiles = useEditorStore((s) => s.characterProfiles);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const target = newName.trim().replace(/\s+/g, ' ');
  const targetKey = characterKey(target);
  const error = !target
    ? t('renameCharacter.enterName')
    : /[()]/.test(target)
      ? t('renameCharacter.noExtensions')
      : null;
  const unchanged = targetKey === name;

  const matches = useMemo(
    () => findCharacterRenameMatches(editor.state.doc, name, target || name),
    // The document is read once per name typed; it cannot change under a modal.
    [editor, name, target],
  );

  // Renaming onto a character the script already has merges the two.
  const mergeInto = targetKey !== name && (
    profiles.some((p) => p.name === targetKey)
    || (() => {
      let found = false;
      editor.state.doc.descendants((n) => {
        if (found) return false;
        if (n.type.name === 'character' && characterKey(n.textContent) === targetKey) found = true;
        return !n.isTextblock;
      });
      return found;
    })()
  );

  const toggle = (i: number) => setExcluded((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const chosenMentions = includeMentions ? matches.mentions.filter((_, i) => !excluded.has(i)) : [];
  const canApply = !error && !unchanged;

  const apply = () => {
    if (!canApply) return;
    const tr = editor.state.tr;
    const changed = applyCharacterRename(tr, [...matches.cues, ...chosenMentions]);
    if (changed > 0) editor.view.dispatch(tr);
    // Back to the script, so the very next Undo reverts the rename.
    editor.commands.focus();
    if (targetKey !== name) renameCharacter(name, targetKey);
    const cueCount = matches.cues.length;
    const details = [
      t('renameCharacter.cueCount', { count: cueCount }),
      ...(chosenMentions.length ? [t('renameCharacter.mentionCount', { count: chosenMentions.length })] : []),
    ].join(', ');
    showToast(t('renameCharacter.renamed', { from: name, to: targetKey, details }), 'success');
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box rename-char-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-char-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      >
        <div className="dialog-header" id="rename-char-title">{t('renameCharacter.title')}</div>
        <div className="dialog-body">
          <div className="dialog-row">
            <label htmlFor="rename-char-input">{t('renameCharacter.renameTo', { name })}</label>
            <input
              id="rename-char-input"
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {error && <p className="rename-char-error" role="alert">{error}</p>}
          {!error && mergeInto && (
            <p className="rename-char-note">
              {t('renameCharacter.merge', { target: targetKey, name })}
            </p>
          )}
          <p className="rename-char-summary">
            {t('renameCharacter.summary.cues', { count: matches.cues.length })}
            {matches.skippedCues > 0 && ` ${t('renameCharacter.summary.skipped', { count: matches.skippedCues })}`}
            {' '}{t('renameCharacter.summary.moves')}
          </p>

          {matches.mentions.length > 0 && (
            <>
              <label className="rename-char-toggle">
                <input
                  type="checkbox"
                  checked={includeMentions}
                  onChange={(e) => setIncludeMentions(e.target.checked)}
                />
                {t('renameCharacter.alsoReplace', { count: matches.mentions.length })}
              </label>
              {includeMentions && (
                <ul className="rename-char-mentions" aria-label={t('renameCharacter.mentionsLabel')}>
                  {matches.mentions.map((m, i) => {
                    const before = m.context.slice(Math.max(0, m.contextOffset - 30), m.contextOffset);
                    const after = m.context.slice(m.contextOffset + m.text.length, m.contextOffset + m.text.length + 30);
                    return (
                      <li key={`${m.from}-${i}`}>
                        <label>
                          <input type="checkbox" checked={!excluded.has(i)} onChange={() => toggle(i)} />
                          <span className="rename-char-mention-type">
                            {elementLabel(m.blockType)}
                          </span>
                          <span className="rename-char-mention-text">
                            {m.contextOffset > 30 && '…'}{before}
                            <del>{m.text}</del><ins>{m.replacement}</ins>
                            {after}{m.contextOffset + m.text.length + 30 < m.context.length && '…'}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>{t('common:cancel')}</button>
          <button className="dialog-primary" onClick={apply} disabled={!canApply}>{t('common:rename')}</button>
        </div>
      </div>
    </div>
  );
};

export default RenameCharacterDialog;
