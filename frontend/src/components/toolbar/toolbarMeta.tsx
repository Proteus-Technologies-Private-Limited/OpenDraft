/**
 * Names, descriptions and icons for every toolbar control and workspace
 * panel, shared by the bars, the Views menu and the Layout dialog.
 */
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FaUndo, FaParagraph, FaFont, FaTextHeight, FaBold, FaAlignLeft, FaSearch, FaStickyNote,
  FaFileAlt, FaFile, FaListOl, FaColumns, FaThLarge, FaAdjust, FaSearchPlus, FaCompass,
  FaList, FaRegFileAlt, FaMapMarkerAlt, FaSitemap, FaBookmark, FaUsers, FaTags, FaMapMarkedAlt,
  FaComments, FaUserEdit, FaPuzzlePiece, FaPlay, FaSlidersH,
} from 'react-icons/fa';
import { pluginRegistry, resolvePluginText } from '../../plugins/registry';
import { TOOLBAR_PANEL_PREFIX, TOOLBAR_PLUGIN_PREFIX } from '../../utils/toolbarLayout';
import { isNavigatorPanel, WORKSPACE_PRESET_IDS } from '../../utils/workspaceLayout';
import { useEditorFields } from '../../stores/editorStore';

export interface ItemMeta {
  label: string;
  description: string;
  icon: React.ReactNode;
}

const ITEM_ICONS: Record<string, React.ReactNode> = {
  'undo-redo': <FaUndo />,
  element: <FaParagraph />,
  font: <FaFont />,
  'font-size': <FaTextHeight />,
  format: <FaBold />,
  align: <FaAlignLeft />,
  search: <FaSearch />,
  notes: <FaStickyNote />,
  document: <FaFile />,
  'title-page': <FaFileAlt />,
  production: <FaListOl />,
  views: <FaColumns />,
  layout: <FaThLarge />,
  theme: <FaAdjust />,
  zoom: <FaSearchPlus />,
  'status-zoom': <FaSlidersH />,
  navigator: <FaCompass />,
};

/** Translation key of each built-in control under toolbar:layout.items. */
const ITEM_KEYS: Record<string, 'undoRedo' | 'element' | 'font' | 'fontSize' | 'format' | 'align' | 'search' | 'notes'
  | 'document' | 'titlePage' | 'production' | 'views' | 'layout' | 'theme' | 'zoom' | 'statusZoom' | 'navigator'> = {
  'undo-redo': 'undoRedo', element: 'element', font: 'font', 'font-size': 'fontSize', format: 'format',
  align: 'align', search: 'search', notes: 'notes', document: 'document', 'title-page': 'titlePage',
  production: 'production', views: 'views', layout: 'layout', theme: 'theme', zoom: 'zoom', 'status-zoom': 'statusZoom', navigator: 'navigator',
};

const PANEL_ICONS: Record<string, React.ReactNode> = {
  scenes: <FaList />,
  pages: <FaRegFileAlt />,
  locations: <FaMapMarkerAlt />,
  structure: <FaSitemap />,
  bookmarks: <FaBookmark />,
  notes: <FaStickyNote />,
  characters: <FaUsers />,
  tags: <FaTags />,
  'location-db': <FaMapMarkedAlt />,
  tuner: <FaComments />,
  suggestions: <FaUserEdit />,
  'add-ons': <FaPuzzlePiece />,
  'table-read': <FaPlay />,
};

/** The name of a panel, as the View menu and the docks show it. */
export function usePanelLabel(): (panel: string) => string {
  const { t } = useTranslation(['story', 'menu', 'toolbar']);
  return useCallback((panel: string) => {
    if (isNavigatorPanel(panel)) return t(`story:navigator.tabs.${panel}`);
    switch (panel) {
      case 'notes': return t('menu:view.notesPanel');
      case 'characters': return t('menu:view.characters');
      case 'tags': return t('menu:view.tags');
      case 'location-db': return t('toolbar:layout.panels.locationDb');
      case 'tuner': return t('menu:view.dialogueTuner');
      case 'suggestions': return t('menu:view.suggestions');
      case 'add-ons': return t('menu:pluginPanels.tabs');
      case 'table-read': return t('menu:tools.tableRead');
      default: break;
    }
    if (panel.startsWith('plugin:')) {
      const entry = pluginRegistry.getPanels('right-sidebar').find((p) => `plugin:${p.id}` === panel);
      if (entry) return resolvePluginText(entry.labelKey, entry.label);
    }
    return panel;
  }, [t]);
}

export function panelIcon(panel: string): React.ReactNode {
  return PANEL_ICONS[panel] ?? <FaPuzzlePiece />;
}

/** Name, description and icon of any toolbar control. */
export function useToolbarItemMeta(): (id: string) => ItemMeta {
  const { t } = useTranslation('toolbar');
  const panelLabel = usePanelLabel();
  return useCallback((id: string): ItemMeta => {
    if (id.startsWith(TOOLBAR_PANEL_PREFIX)) {
      const panel = id.slice(TOOLBAR_PANEL_PREFIX.length);
      const label = panelLabel(panel);
      return { label, description: t('layout.items.panel.description', { panel: label }), icon: panelIcon(panel) };
    }
    if (id.startsWith(TOOLBAR_PLUGIN_PREFIX)) {
      const entry = pluginRegistry.getPanels('toolbar').find((p) => `${TOOLBAR_PLUGIN_PREFIX}${p.id}` === id);
      const label = entry ? resolvePluginText(entry.labelKey, entry.label) : id.slice(TOOLBAR_PLUGIN_PREFIX.length);
      return { label, description: t('layout.items.plugin.description'), icon: <FaPuzzlePiece /> };
    }
    const key = ITEM_KEYS[id];
    if (!key) return { label: id, description: '', icon: <FaPuzzlePiece /> };
    return {
      label: t(`layout.items.${key}.label`),
      description: t(`layout.items.${key}.description`),
      icon: ITEM_ICONS[id] ?? <FaPuzzlePiece />,
    };
  }, [t, panelLabel]);
}

/** The workspace layouts a writer can switch to: the built-in ones, then their own. */
export function useWorkspaceLayoutChoices(): { id: string; label: string }[] {
  const { t } = useTranslation('toolbar');
  const { savedWorkspaceLayouts } = useEditorFields('savedWorkspaceLayouts');
  return useMemo(() => [
    ...WORKSPACE_PRESET_IDS.map((id) => ({ id, label: t(`layout.presets.${id}`) })),
    ...savedWorkspaceLayouts.map((saved) => ({ id: saved.id, label: saved.label })),
  ], [t, savedWorkspaceLayouts]);
}
