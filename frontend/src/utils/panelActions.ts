/**
 * Open, close and read the panels by their workspace ids.
 *
 * Each panel keeps the open state it always had (navigatorOpen,
 * scriptNotesOpen, the Table Read store…); this maps the workspace's panel ids
 * onto them, so the toolbar's panel buttons, the docks and the Layout dialog
 * share one switch per panel.
 *
 * The Navigator's five panels share one switch, `navigatorOpen`: the Navigator
 * button shows or hides all of them wherever they are placed, and a button for
 * one of them opens the Navigator on that panel's tab.
 */
import { useEditorStore, useEditorFields } from '../stores/editorStore';
import { useTableReadStore } from '../stores/tableReadStore';
import { useSuggestModeStore } from '../stores/suggestModeStore';
import { groupOfPanel, isNavigatorPanel, placeOfPanel } from './workspaceLayout';

/** The view that owns the writing area. */
export type MainView = 'script' | 'index-cards' | 'beat-board' | 'outline';

/** Whether a panel is showing, wherever the layout puts it. */
export function usePanelOpen(panel: string): boolean {
  const fields = useEditorFields(
    'navigatorOpen', 'scriptNotesOpen', 'characterProfilesOpen', 'tagsPanelOpen',
    'locationDatabaseOpen', 'sceneDetailsOpen', 'dialogueTunerOpen',
  );
  const suggestions = useSuggestModeStore((s) => s.panelOpen);
  const tableRead = useTableReadStore((s) => s.open);
  return panelOpenIn(panel, { ...fields, suggestions, tableRead });
}

interface OpenFlags {
  navigatorOpen: boolean;
  scriptNotesOpen: boolean;
  characterProfilesOpen: boolean;
  tagsPanelOpen: boolean;
  locationDatabaseOpen: boolean;
  sceneDetailsOpen: boolean;
  dialogueTunerOpen: boolean;
  suggestions: boolean;
  tableRead: boolean;
}

export function panelOpenIn(panel: string, f: OpenFlags): boolean {
  if (isNavigatorPanel(panel)) return f.navigatorOpen;
  switch (panel) {
    case 'notes': return f.scriptNotesOpen;
    case 'characters': return f.characterProfilesOpen;
    case 'tags': return f.tagsPanelOpen;
    case 'location-db': return f.locationDatabaseOpen;
    case 'scene-details': return f.sceneDetailsOpen;
    case 'tuner': return f.dialogueTunerOpen;
    case 'suggestions': return f.suggestions;
    case 'table-read': return f.tableRead;
    // The add-on strip shows whenever an add-on has a panel; it collapses itself.
    case 'add-ons': return true;
    default: return panel.startsWith('plugin:');
  }
}

function currentFlags(): OpenFlags {
  const s = useEditorStore.getState();
  return {
    navigatorOpen: s.navigatorOpen,
    scriptNotesOpen: s.scriptNotesOpen,
    characterProfilesOpen: s.characterProfilesOpen,
    tagsPanelOpen: s.tagsPanelOpen,
    locationDatabaseOpen: s.locationDatabaseOpen,
    sceneDetailsOpen: s.sceneDetailsOpen,
    dialogueTunerOpen: s.dialogueTunerOpen,
    suggestions: useSuggestModeStore.getState().panelOpen,
    tableRead: useTableReadStore.getState().open,
  };
}

export function isPanelOpen(panel: string): boolean {
  return panelOpenIn(panel, currentFlags());
}

function setPanelOpen(panel: string, open: boolean): void {
  if (isPanelOpen(panel) === open) return;
  const s = useEditorStore.getState();
  if (isNavigatorPanel(panel)) { s.toggleNavigator(); return; }
  switch (panel) {
    case 'notes': s.toggleScriptNotes(); return;
    case 'characters': s.toggleCharacterProfiles(); return;
    case 'tags': s.toggleTagsPanel(); return;
    case 'location-db': s.toggleLocationDatabase(); return;
    case 'scene-details': s.toggleSceneDetails(); return;
    case 'tuner': if (open) s.openDialogueTuner(); else s.closeDialogueTuner(); return;
    case 'suggestions': useSuggestModeStore.getState().setPanelOpen(open); return;
    case 'table-read':
      if (open) useTableReadStore.getState().openTableRead();
      else useTableReadStore.getState().setOpen(false);
      return;
    default:
      console.warn('[panelActions] no open/close switch for panel', panel);
  }
}

/** Bring a panel up: open it and make it the tab its group shows. */
export function showPanel(panel: string): void {
  const s = useEditorStore.getState();
  const group = groupOfPanel(s.workspaceLayout, panel);
  if (group) s.setDockActive(group, panel);
  setPanelOpen(panel, true);
}

/** Close a panel, wherever the layout puts it. */
export function hidePanel(panel: string): void {
  setPanelOpen(panel, false);
}

/**
 * A toolbar panel button. Closed: open it on this panel. Open on another tab
 * of its group: switch to this one. Already showing: close it.
 */
export function togglePanel(panel: string): void {
  const s = useEditorStore.getState();
  if (!isPanelOpen(panel)) { showPanel(panel); return; }
  const group = groupOfPanel(s.workspaceLayout, panel);
  const groupPanels = group ? s.workspaceLayout.groups[group].panels : [];
  const showing = !group || groupPanels.length < 2 || s.workspaceLayout.groups[group].mode === 'stacked'
    || (s.dockActive[group] ?? groupPanels.find(isPanelOpen)) === panel;
  if (showing) setPanelOpen(panel, false);
  else s.setDockActive(group!, panel);
}

/** Whether the layout gives the panel a place at all. */
export function isPanelPlaced(panel: string): boolean {
  return placeOfPanel(useEditorStore.getState().workspaceLayout, panel) !== 'hidden';
}

/**
 * Choose the view that owns the writing area. Index Cards, the Beat Board and
 * the Outline each take the whole screen, so choosing one closes the others;
 * Script closes them all.
 */
export function setMainView(view: MainView): void {
  const s = useEditorStore.getState();
  if (s.statisticsOpen) s.setStatisticsOpen(false);
  if ((view === 'index-cards') !== s.indexCardsOpen) s.toggleIndexCards();
  if ((view === 'beat-board') !== s.beatBoardOpen) s.toggleBeatBoard();
  if ((view === 'outline') !== useEditorStore.getState().outlineOpen) useEditorStore.getState().toggleOutline();
}

export function currentMainView(s: { indexCardsOpen: boolean; beatBoardOpen: boolean; outlineOpen: boolean }): MainView {
  if (s.indexCardsOpen) return 'index-cards';
  if (s.beatBoardOpen) return 'beat-board';
  if (s.outlineOpen) return 'outline';
  return 'script';
}
