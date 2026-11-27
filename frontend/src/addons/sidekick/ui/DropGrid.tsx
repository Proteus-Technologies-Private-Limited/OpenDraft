/**
 * The task types as targets: drag a selection out of the script onto one, or
 * tap/click one to file the current selection — the way to do it where
 * dragging text out of the editor does not work (most touch screens).
 */
import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useTranslation } from 'react-i18next';
import { PLUGIN_ID, type TaskKind, type TaskType } from '../model';
import { canFile, fileSelection, typeLabel, type FileResult } from '../actions';
import { TypeIcon } from './icons';

interface Props {
  editor: Editor | null;
  types: TaskType[];
  hasSelection: boolean;
  onFiled: (result: FileResult) => void;
}

/** Whether a drag carries something the Sidekick can file. */
function acceptsDrag(e: React.DragEvent): boolean {
  const kinds = Array.from(e.dataTransfer?.types ?? []);
  return kinds.includes('text/html') || kinds.includes('text/plain');
}

/** Touch screens rarely drag selected text, so their help only mentions tapping. */
function prefersTap(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch (err) {
    console.warn('[sidekick] could not tell the pointer type', err);
    return false;
  }
}

export function DropGrid({ editor, types, hasSelection, onFiled }: Props) {
  const { t } = useTranslation(PLUGIN_ID);
  const [touch] = useState(prefersTap);
  const [over, setOver] = useState<string | null>(null);
  // A drag is over the drop area (counted: enter/leave fire for every child).
  const [depth, setDepth] = useState(0);
  const dragging = depth > 0;
  const groups: Array<{ kind: TaskKind; label: string; types: TaskType[] }> = [
    { kind: 'track', label: t('panel.track'), types: types.filter((type) => type.kind === 'track') },
    { kind: 'keep', label: t('panel.keep'), types: types.filter((type) => type.kind === 'keep') },
  ];

  const drop = (e: React.DragEvent, type: TaskType) => {
    e.preventDefault();
    // The editor area handles file drops for import; this one is ours.
    e.stopPropagation();
    setOver(null);
    setDepth(0);
    onFiled(fileSelection(editor, type.id, e.dataTransfer));
  };

  return (
    <section
      className={`sk-drop${dragging ? ' sk-drop--active' : ''}`}
      aria-label={t('panel.dropTitle')}
      onDragEnter={(e) => { if (acceptsDrag(e)) setDepth((d) => d + 1); }}
      onDragLeave={(e) => { if (acceptsDrag(e)) setDepth((d) => Math.max(0, d - 1)); }}
      onDrop={() => setDepth(0)}
    >
      <p className="sk-help">
        {dragging ? t('panel.dropHere') : hasSelection ? t(touch ? 'panel.dropHelpTouch' : 'panel.dropHelp') : t('panel.dropHelpEmpty')}
      </p>
      {groups.map((group) => group.types.length > 0 && (
        <div key={group.kind} className="sk-drop__group">
          <h3 className="sk-drop__heading">{group.label}</h3>
          <div className="sk-drop__chips">
            {group.types.map((type) => {
              const action = t(type.scriptLink === 'none' ? 'panel.noScriptLink' : type.textAction === 'move' ? 'panel.moveText' : 'panel.copyText');
              return (
                <button
                  key={type.id}
                  type="button"
                  className={`sk-chip${over === type.id ? ' sk-chip--over' : ''}`}
                  style={{ '--sk-type-color': type.color } as React.CSSProperties}
                  title={type.hint ? `${type.hint} ${action}` : action}
                  aria-disabled={!canFile(editor, type)}
                  onClick={() => { if (canFile(editor, type)) onFiled(fileSelection(editor, type.id)); }}
                  onDragEnter={(e) => { if (type.scriptLink !== 'none' && acceptsDrag(e)) { e.preventDefault(); setOver(type.id); } }}
                  onDragOver={(e) => {
                    if (type.scriptLink === 'none' || !acceptsDrag(e)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = type.textAction === 'copy' ? 'copy' : 'move';
                    if (over !== type.id) setOver(type.id);
                  }}
                  onDragLeave={() => setOver((current) => (current === type.id ? null : current))}
                  onDrop={(e) => { if (type.scriptLink !== 'none' && acceptsDrag(e)) drop(e, type); }}
                >
                  <TypeIcon icon={type.icon} />
                  <span>{typeLabel(type)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
