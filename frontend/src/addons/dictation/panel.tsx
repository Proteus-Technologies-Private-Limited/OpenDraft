import type { Editor } from '@tiptap/core';
import { useProjectStore } from '../../stores/projectStore';
import DictationDialog from './DictationDialog';
const identities = new WeakMap<Editor, number>();
let nextId = 0;
export default function DictationPanel({ editor }: { editor: Editor | null }) {
  const project = useProjectStore(s => s.currentProject?.id);
  const script = useProjectStore(s => s.currentScriptId);
  if (!editor || editor.isDestroyed || !editor.isEditable) return <p>Open an editable screenplay to use dictation.</p>;
  if (!identities.has(editor)) identities.set(editor, ++nextId);
  return <DictationDialog key={`${identities.get(editor)}:${project}:${script}`} editor={editor} />;
}
