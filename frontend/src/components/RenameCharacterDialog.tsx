import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorStore, ELEMENT_LABELS, type ElementType } from '../stores/editorStore';
import { characterKey } from '../utils/nodeText';
import { applyCharacterRename, findCharacterRenameMatches } from '../editor/characterRename';
import { showToast } from './Toast';

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
    ? 'Enter a name.'
    : /[()]/.test(target)
      ? 'Leave out extensions like (V.O.) — they are kept on each cue.'
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
    showToast(
      `Renamed ${name} to ${targetKey} — ${cueCount} cue${cueCount === 1 ? '' : 's'}`
      + (chosenMentions.length ? `, ${chosenMentions.length} mention${chosenMentions.length === 1 ? '' : 's'}` : ''),
      'success',
    );
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
        <div className="dialog-header" id="rename-char-title">Rename Character</div>
        <div className="dialog-body">
          <div className="dialog-row">
            <label htmlFor="rename-char-input">Rename {name} to</label>
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
              {targetKey} already exists — the two will be merged. {targetKey}&rsquo;s profile is kept and filled in from {name}&rsquo;s.
            </p>
          )}
          <p className="rename-char-summary">
            {matches.cues.length} cue{matches.cues.length === 1 ? '' : 's'} will be renamed, keeping extensions like (V.O.) and (CONT&rsquo;D).
            {matches.skippedCues > 0 && ` ${matches.skippedCues} cue${matches.skippedCues === 1 ? ' is' : 's are'} split across lines and must be renamed by hand.`}
            {' '}The profile, relationships and Cast tags move with the name.
          </p>

          {matches.mentions.length > 0 && (
            <>
              <label className="rename-char-toggle">
                <input
                  type="checkbox"
                  checked={includeMentions}
                  onChange={(e) => setIncludeMentions(e.target.checked)}
                />
                Also replace {matches.mentions.length} mention{matches.mentions.length === 1 ? '' : 's'} in action, dialogue and headings
              </label>
              {includeMentions && (
                <ul className="rename-char-mentions" aria-label="Mentions to replace">
                  {matches.mentions.map((m, i) => {
                    const before = m.context.slice(Math.max(0, m.contextOffset - 30), m.contextOffset);
                    const after = m.context.slice(m.contextOffset + m.text.length, m.contextOffset + m.text.length + 30);
                    return (
                      <li key={`${m.from}-${i}`}>
                        <label>
                          <input type="checkbox" checked={!excluded.has(i)} onChange={() => toggle(i)} />
                          <span className="rename-char-mention-type">
                            {ELEMENT_LABELS[m.blockType as ElementType] ?? m.blockType}
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
          <button onClick={onClose}>Cancel</button>
          <button className="dialog-primary" onClick={apply} disabled={!canApply}>Rename</button>
        </div>
      </div>
    </div>
  );
};

export default RenameCharacterDialog;
