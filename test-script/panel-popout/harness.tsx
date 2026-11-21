// Copied temporarily into frontend by regressions.py; never part of the app build.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Editor, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent } from '@tiptap/react';
import { undoDepth } from '@tiptap/pm/history';
import { useNavigatorPopout } from './src/hooks/useNavigatorPopout';
import NavigatorPopout from './src/components/NavigatorPopout';
import { useEditorStore } from './src/stores/editorStore';
import { initI18n, setLanguage } from './src/i18n';
import { applyAppearance } from './src/utils/appearance';
import './src/styles/screenplay.css';
const Heading = Node.create({ name: 'sceneHeading', group: 'block', content: 'inline*', attrs: {}, addAttributes: () => ({ synopsis: { default: '' }, sceneColor: { default: '' } }), renderHTML: () => ['h2', 0] });
function Owner() {
  const [editor] = useState(() => new Editor({ extensions: [StarterKit, Heading], content: { type: 'doc', content: [
    { type: 'sceneHeading', attrs: { synopsis: 'A quiet room.' }, content: [{ type: 'text', text: 'INT. ROOM - DAY' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'She waits.' }] },
    { type: 'sceneHeading', attrs: { synopsis: 'Footsteps outside.' }, content: [{ type: 'text', text: 'EXT. STREET - NIGHT' }] },
  ] } }));
  const [identity, setIdentity] = useState('one');
  const popout = useNavigatorPopout(editor, identity);
  useEffect(() => {
    (window as any).panelTest = {
      doc: () => JSON.stringify(editor.getJSON()), undo: () => undoDepth(editor.state),
      select: (pos: number) => editor.commands.setTextSelection(pos), selection: () => editor.state.selection.from,
      insert: (text: string) => editor.commands.insertContent(text),
      replace: () => editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }),
      switch: () => setIdentity(value => value === 'one' ? 'two' : 'one'),
      appearance: (appearance: 'light' | 'dark' | 'dark-pages') => useEditorStore.setState({ appearance }),
      language: (language: 'en' | 'ar') => setLanguage(language),
    };
    return () => editor.destroy();
  }, [editor]);
  return <main><h1>Owner test fixture</h1><button onClick={popout.open}>Open Navigator</button><output id="detached">{String(popout.detached)}</output><EditorContent editor={editor} /></main>;
}
async function start() {
  await initI18n();
  useEditorStore.setState({ documentTitle: 'Synthetic screenplay', appearance: 'dark' });
  applyAppearance('dark');
  createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('role') === 'panel' ? <NavigatorPopout /> : <Owner />);
}
void start();
