import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import { useEditorStore, ELEMENT_LABELS } from '../stores/editorStore';
import { useTableReadStore } from '../stores/tableReadStore';
import { isAiProviderConfigured, useVoiceSettingsStore } from '../stores/voiceSettingsStore';
import { activeEngineKind } from '../services/tts/engines';
import { play } from '../services/tts/player';
import {
  collectSpeeches, editLineTransaction, listSpeakers, speakerAt, type TunerLine,
} from '../utils/dialogueTuner';
import Select from './Select';
import { showToast } from './Toast';

interface DialogueTunerProps {
  editor: Editor | null;
  style?: React.CSSProperties;
}

/** Put the caret in the script at `pos` and bring it into view. */
function goTo(editor: Editor, pos: number) {
  const at = Math.min(pos + 1, editor.state.doc.content.size);
  editor.chain().focus().setTextSelection(at).run();
  requestAnimationFrame(() => {
    const coords = editor.view.coordsAtPos(at);
    const main = document.querySelector('.editor-main');
    if (!main || !coords) return;
    const rect = main.getBoundingClientRect();
    main.scrollTo({ top: main.scrollTop + (coords.top - rect.top) - rect.height / 3, behavior: 'auto' });
  });
}

/**
 * One line of a speech, edited in place. The draft lives here only while the
 * box has focus; otherwise the box shows the script, so an edit made in the
 * script or by a collaborator appears straight away.
 */
const TunerLineField: React.FC<{ editor: Editor; line: TunerLine }> = ({ editor, line }) => {
  // What the line was, and where, when editing began: the edit is checked
  // against that, never against whatever line this box shows by the end.
  const [edit, setEdit] = useState<{ pos: number; base: string; draft: string } | null>(null);
  const shown = edit ? edit.draft : line.text;
  const setDraft = (draft: string) => setEdit((e) => (e ? { ...e, draft } : e));
  // Esc blurs the box to cancel; the blur must not then save what it cancelled.
  const cancelled = useRef(false);

  const commit = () => {
    if (!edit) return;
    setEdit(null);
    if (cancelled.current) { cancelled.current = false; return; }
    if (edit.draft === edit.base) return;
    const tr = editLineTransaction(editor.state, edit.pos, edit.base, edit.draft);
    if (tr) editor.view.dispatch(tr);
    else showToast('That line changed in the script while you were editing it — your edit was not applied.', 'error');
  };

  return (
    <textarea
      className={`dialogue-tuner-line dialogue-tuner-${line.type}`}
      value={shown}
      rows={Math.max(1, shown.split('\n').length)}
      spellCheck
      aria-label={ELEMENT_LABELS[line.type] ?? line.type}
      onFocus={() => setEdit({ pos: line.pos, base: line.text, draft: line.text })}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // As in the script: Enter finishes the line, Shift+Enter breaks it.
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
        if (e.key === 'Escape') { e.stopPropagation(); cancelled.current = true; (e.target as HTMLTextAreaElement).blur(); }
      }}
    />
  );
};

const DialogueTuner: React.FC<DialogueTunerProps> = ({ editor, style }) => {
  const open = useEditorStore((s) => s.dialogueTunerOpen);
  const close = useEditorStore((s) => s.closeDialogueTuner);
  const chosen = useEditorStore((s) => s.dialogueTunerCharacter);
  const setChosen = useEditorStore((s) => s.setDialogueTunerCharacter);
  const [showBefore, setShowBefore] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const { shouldRender, animationState } = useDelayedUnmount(open, 250);
  useSwipeDismiss(panelRef, { direction: 'right', onDismiss: close, enabled: shouldRender });

  const doc = editor?.state.doc;
  const speakers = useMemo(() => (doc && open ? listSpeakers(doc) : []), [doc, open]);
  // Opened without a character: take whoever speaks at the cursor, once —
  // after that the tuner stays on them while the writer works in the script.
  useEffect(() => {
    if (!open || chosen || !editor) return;
    const here = speakerAt(editor.state.doc, editor.state.selection.from);
    if (here) setChosen(here);
  }, [open, chosen, editor, setChosen]);
  const character = chosen && speakers.some((s) => s.name === chosen) ? chosen : (speakers[0]?.name ?? '');
  const speeches = useMemo(() => (doc && character ? collectSpeeches(doc, character) : []), [doc, character]);
  const lineCount = speeches.reduce((n, s) => n + s.lines.filter((l) => l.type !== 'parenthetical').length, 0);

  const hear = (cuePos: number) => {
    if (!editor) return;
    goTo(editor, cuePos);
    const tr = useTableReadStore.getState();
    tr.setOpen(true);
    const vs = useVoiceSettingsStore.getState();
    if (activeEngineKind(vs) === 'ai' && !isAiProviderConfigured(vs)) { tr.setNeedsProvider(true); return; }
    play(editor);
  };

  if (!shouldRender) return null;
  const panelClass = animationState === 'entered' ? 'panel-open' : animationState === 'exiting' ? 'panel-closing' : '';

  return (
    // `tags-panel` for the shared side-panel layout, including its phone and
    // tablet overlay rules; `dialogue-tuner` for everything of its own.
    <div ref={panelRef} className={`tags-panel dialogue-tuner ${panelClass}`} style={style} aria-label="Dialogue Tuner">
      <div className="tags-panel-header">
        <span className="tags-panel-title">Dialogue Tuner</span>
        <span className="tags-panel-count" title="Lines of dialogue">{lineCount}</span>
        <button className="tags-panel-close" onClick={close} title="Close" aria-label="Close Dialogue Tuner">&times;</button>
      </div>

      {speakers.length > 0 && (
        <div className="dialogue-tuner-controls">
          <Select value={character} onChange={(e) => setChosen(e.target.value)} aria-label="Character">
            {speakers.map((s) => (
              <option key={s.name} value={s.name}>{s.name} ({s.speeches})</option>
            ))}
          </Select>
          <label className="dialogue-tuner-toggle">
            <input type="checkbox" checked={showBefore} onChange={(e) => setShowBefore(e.target.checked)} />
            Show the line before
          </label>
        </div>
      )}

      <div className="tags-panel-list dialogue-tuner-list">
        {!editor || speakers.length === 0 ? (
          <div className="tags-panel-empty">No dialogue yet. Character cues and their lines appear here.</div>
        ) : (
          speeches.map((s, i) => {
            const newScene = i === 0 || speeches[i - 1].sceneIndex !== s.sceneIndex;
            return (
              <React.Fragment key={i}>
                {newScene && (
                  <div className="dialogue-tuner-scene">
                    {s.sceneIndex > 0 ? `${s.sceneIndex}. ${s.scene}` : 'Before the first scene'}
                  </div>
                )}
                <div className="dialogue-tuner-speech">
                  {showBefore && s.before && (
                    <div className="dialogue-tuner-before" title={ELEMENT_LABELS[s.before.type] ?? s.before.type}>
                      {s.before.speaker && <span className="dialogue-tuner-before-speaker">{s.before.speaker}: </span>}
                      {s.before.text}
                    </div>
                  )}
                  <div className="dialogue-tuner-cue-row">
                    <button className="dialogue-tuner-cue" onClick={() => editor && goTo(editor, s.cuePos)} title="Go to this line in the script">
                      {s.cue}
                    </button>
                    <button className="dialogue-tuner-hear" onClick={() => hear(s.cuePos)} title="Hear it in Table Read" aria-label={`Hear ${s.cue}'s line in Table Read`}>
                      &#9654;
                    </button>
                  </div>
                  {s.lines.length === 0 && <div className="dialogue-tuner-nolines">(no dialogue under this cue)</div>}
                  {s.lines.map((l, j) => (
                    <TunerLineField key={`${i}:${j}`} editor={editor} line={l} />
                  ))}
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
};

export default DialogueTuner;
