/**
 * The OD Sidekick plugin: one `OpenDraftPlugin` object. Each field is one of
 * core's extension points; see core's docs/PLUGIN_DEVELOPMENT.md.
 *
 * The tasks live in the script and travel wherever the script is saved or shared.
 */
import { createElement } from 'react';
import { FaTasks } from 'react-icons/fa';
import type { OpenDraftPlugin, PluginMenuChildEntry } from '../../plugins/registry';
import { readData } from './data';
import { DEFAULT_KEEP_TYPE_ID, DEFAULT_TYPE_ID, findType, PANEL_ID, PLUGIN_ID, visibleTypes } from './model';
import { canFile, fileSelectionWithFeedback, openPanel, typeLabel } from './actions';
import { exporter, report, SidekickShortcuts } from './outputs';
import { SidekickPanel } from './ui/SidekickPanel';
import { StatusBarItem } from './ui/StatusBarItem';

const key = (k: string) => `${PLUGIN_ID}:${k}`;

/** The shortcut as this platform writes it: ⌥⌘T on Apple keyboards, Ctrl+Alt+T elsewhere. */
function shortcut(letter: string): string {
  const apple = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
  return apple ? `⌥⌘${letter}` : `Ctrl+Alt+${letter}`;
}

/** Tools → Sidekick → Add Task To → one item per visible type. */
function addToChildren(): PluginMenuChildEntry[] {
  return visibleTypes(readData()).map((type) => ({
    id: `od-sidekick-add-${type.id}`,
    get label() { return typeLabel(type); },
    action: ({ editor }) => { fileSelectionWithFeedback(editor, type.id); },
    disabled: ({ editor }) => !canFile(editor, type),
  }));
}

// i18n-ignore-start: plugin defaults with translation keys for registry contributions
export const sidekickPlugin: OpenDraftPlugin = {
  id: PLUGIN_ID,
  name: 'Sidekick',
  nameKey: key('plugin.name'),
  version: '0.1.0',
  optIn: true,
  defaultEnabled: true,
  privacy: 'Sidekick makes no network requests. Tasks travel with the script when you sync, share or export it.',
  description: 'Keep to-dos and material held for later inside the script.',
  descriptionKey: key('plugin.description'),

  panels: [
    { id: PANEL_ID, slot: 'right-sidebar', label: 'Sidekick', labelKey: key('panel.title'), component: SidekickPanel, order: 40 },
    { id: 'od-sidekick-status', slot: 'status-bar', label: 'Sidekick', labelKey: key('panel.title'), component: StatusBarItem },
  ],

  menuItems: [
    {
      id: 'od-sidekick-menu',
      section: 'Tools',
      label: 'Sidekick',
      labelKey: key('menu.sidekick'),
      icon: createElement(FaTasks),
      order: 60,
      children: [
        { id: 'od-sidekick-open', label: 'Show Sidekick', labelKey: key('menu.open'), action: () => openPanel() },
        { id: 'od-sidekick-sep', label: '', separator: true },
        {
          id: 'od-sidekick-add-todo',
          label: 'Add to To Do',
          labelKey: key('menu.addTodo'),
          get shortcut() { return shortcut('T'); },
          action: ({ editor }) => { fileSelectionWithFeedback(editor, DEFAULT_TYPE_ID); },
          disabled: ({ editor }) => !canFile(editor, findType(readData(), DEFAULT_TYPE_ID)),
        },
        {
          id: 'od-sidekick-add-hold',
          label: 'Add to Hold for Later',
          labelKey: key('menu.addHold'),
          get shortcut() { return shortcut('K'); },
          action: ({ editor }) => { fileSelectionWithFeedback(editor, DEFAULT_KEEP_TYPE_ID); },
          disabled: ({ editor }) => !canFile(editor, findType(readData(), DEFAULT_KEEP_TYPE_ID)),
        },
        {
          id: 'od-sidekick-add-to',
          label: 'Add Task To',
          labelKey: key('menu.addTo'),
          // A getter, so the list follows the script's own and hidden types.
          get children() { return addToChildren(); },
        },
      ],
    },
  ],

  editorExtensions: [SidekickShortcuts],
  reports: [report],
  exporters: [exporter],
};
// i18n-ignore-end
