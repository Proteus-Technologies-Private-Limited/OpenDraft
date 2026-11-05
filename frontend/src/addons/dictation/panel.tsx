import type { Editor } from '@tiptap/core';
import { useProjectStore } from '../../stores/projectStore';
import { useTranslation } from 'react-i18next';
import DictationDialog from './DictationDialog';
const identities = new WeakMap<Editor, number>();
let nextId = 0;
export default function DictationPanel({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation('addons');
  const project = useProjectStore(s => s.currentProject?.id);
  const script = useProjectStore(s => s.currentScriptId);
  if (!editor || editor.isDestroyed || !editor.isEditable) return <p>{t('dictation.openEditable')}</p>;
  if (!identities.has(editor)) identities.set(editor, ++nextId);
  return <DictationDialog key={`${identities.get(editor)}:${project}:${script}`} editor={editor} />;
}
