import type { SplitScreenPane } from '../stores/editorStore';
import type { FoldState } from './foldPosture';

/** Keep view choices intact: posture changes placement, never the chosen view or split mode. */
export function foldCompanionPlacement(fold: FoldState & { foldable: boolean }): 'side' | 'bottom' | 'column' | null {
  if (!fold.foldable || (fold.fold === 'flat' && fold.size === 'phone')) return null;
  if (fold.fold === 'laptop') return 'bottom';
  if (fold.fold === 'book') return 'side';
  const rect = fold.foldRect;
  if (rect) return rect.height > rect.width ? 'side' : 'bottom';
  return 'column';
}

export function companionView(state: {
  outlineOpen: boolean; beatBoardOpen: boolean; indexCardsOpen: boolean;
  statisticsOpen: boolean; splitScreenOpen: boolean; splitScreenPane: SplitScreenPane;
}, history: boolean): { pane: SplitScreenPane | null; main: boolean } {
  if (history) return { pane: null, main: false };
  if (state.outlineOpen) return { pane: 'outline', main: true };
  if (state.statisticsOpen) return { pane: null, main: false };
  if (state.beatBoardOpen) return { pane: 'beat-board', main: true };
  if (state.splitScreenOpen) return { pane: state.splitScreenPane, main: false };
  return { pane: state.indexCardsOpen ? 'index-cards' : null, main: state.indexCardsOpen };
}
