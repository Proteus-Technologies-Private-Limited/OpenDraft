// Copied temporarily into frontend by regressions.py; never part of the app build.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Editor, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent } from '@tiptap/react';
import { undoDepth } from '@tiptap/pm/history';
import { notifyPanelDocumentReplacement, useNavigatorPopout } from './src/hooks/useNavigatorPopout';
import { useEditorStore } from './src/stores/editorStore';
import { useProjectStore } from './src/stores/projectStore';
import { useLinkedFileStore } from './src/stores/linkedFileStore';
import { initI18n, setLanguage } from './src/i18n';
import { applyAppearance } from './src/utils/appearance';
import './src/styles/screenplay.css';
const Heading = Node.create({ name: 'sceneHeading', group: 'block', content: 'inline*', addAttributes: () => ({ synopsis: { default: '' }, sceneColor: { default: '' } }), renderHTML: () => ['h2', 0] });
function Owner() {
  const [editor] = useState(() => new Editor({ extensions: [StarterKit, Heading], content: { type: 'doc', content: [
    { type: 'sceneHeading', attrs: { synopsis: 'A quiet room.' }, content: [{ type: 'text', text: 'INT. ROOM - DAY' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'She waits.' }] },
    { type: 'sceneHeading', attrs: { synopsis: 'Footsteps outside.' }, content: [{ type: 'text', text: 'EXT. STREET - NIGHT' }] },
  ] } }));
  const scriptId = useProjectStore(state => state.currentScriptId);
  const popout = useNavigatorPopout(editor, scriptId);
  const { keepForSavedScript } = popout;
  useEffect(() => {
    (window as any).panelTest = {
      doc: () => JSON.stringify(editor.getJSON()), undo: () => undoDepth(editor.state),
      select: (pos: number) => editor.commands.setTextSelection(pos), selection: () => editor.state.selection.from,
      insert: (text: string) => editor.commands.insertContent(text),
      replace: () => { notifyPanelDocumentReplacement(editor); editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }); },
      rewriteSameDocument: () => editor.commands.setContent(editor.getJSON()),
      saveToLibrary: () => useProjectStore.getState().setCurrentScriptId('one'),
      saveToFile: () => useLinkedFileStore.getState().setOpenScriptFile({ scriptId: 'one', path: '/synthetic/screenplay.odraft' }),
      saveCopy: () => {
        keepForSavedScript('copy');
        useProjectStore.getState().setCurrentScriptId('copy');
      },
      switch: () => useProjectStore.getState().setCurrentScriptId('two'),
      insertInBody: () => {
        editor.state.doc.forEach((node, pos) => {
          if (node.type.name === 'paragraph') editor.commands.insertContentAt(pos + 2, 'still ');
        });
      },
      appearance: (appearance: 'light' | 'dark' | 'dark-pages') => useEditorStore.setState({ appearance }),
      language: (language: 'en' | 'ar') => setLanguage(language),
      navigatorOpen: () => useEditorStore.getState().navigatorOpen,
      hideNavigator: () => useEditorStore.setState({ navigatorOpen: false }),
    };
    return () => editor.destroy();
  }, [editor, keepForSavedScript]);
  return <main><h1>Owner test fixture</h1><button onClick={popout.open}>Open Navigator</button><output id="detached">{String(popout.detached)}</output><EditorContent editor={editor} /></main>;
}
async function start() {
  await initI18n();
  useProjectStore.getState().setCurrentScriptId(null);
  useEditorStore.setState({ documentTitle: 'Synthetic screenplay', appearance: 'dark', navigatorOpen: false });
  applyAppearance('dark');
  createRoot(document.getElementById('root')!).render(<Owner />);
}
void start();
