import type { Editor } from '@tiptap/react';
import type { SplitScreenPane } from '../stores/editorStore';
import IndexCards from './IndexCards';
import OutlineView from './OutlineView';
import BeatBoard from './BeatBoard';
import PagePreviewPane from './PagePreviewPane';

/** One mounted view, whether it fills the editor, splits it or follows a fold. */
export default function CompanionPane({ editor, pane, embedded, onClose }: {
  editor: Editor; pane: SplitScreenPane; embedded: boolean; onClose: () => void;
}) {
  return <div className={`companion-pane split-pane split-pane-${pane}${embedded ? ' is-companion' : ''}`}>
    {pane === 'index-cards' && <IndexCards editor={editor} variant={embedded ? 'split' : 'view'} onRequestClose={onClose} />}
    {pane === 'outline' && <OutlineView editor={editor} embedded={embedded} onRequestClose={onClose} />}
    {pane === 'beat-board' && <BeatBoard editor={editor} embedded={embedded} onRequestClose={onClose} />}
    {pane === 'page-view' && <PagePreviewPane editor={editor} onRequestClose={onClose} />}
  </div>;
}
