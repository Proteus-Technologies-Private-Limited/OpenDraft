/**
 * AI Assistant: an opt-in add-on, off until the writer turns it on.
 *
 * Everything the app sees of it is declared here. The Tools menu item opens the
 * sidebar panel by dispatching `plugin-panel:open`; it does not reach into the
 * editor, the toolbar or the menus, so turning the add-on off removes all of it.
 */
import { t } from '../../i18n';
import type { OpenDraftPlugin } from '../../plugins/registry';
import { PLUGIN_PANEL_OPEN_EVENT } from '../../components/PluginPanelTabs';
import AssistantPanel from './AssistantPanel';
import AssistantSettingsForm from './AssistantSettingsForm';
import { forgetSettings } from './settingsStore';

const PANEL_ID = 'ai-assistant-panel';

const aiAssistant: OpenDraftPlugin = {
  id: 'ai-assistant',
  // Getters, so the text is looked up when it is shown and follows the interface language.
  get name() { return t('addons:assistant.plugin.name'); },
  version: '1.0.0',
  optIn: true,
  get description() { return t('addons:assistant.plugin.description'); },
  get privacy() { return t('addons:assistant.plugin.privacy'); },
  settings: AssistantSettingsForm,
  onDeactivate: ({ forgetSettings: forget }) => {
    if (forget) forgetSettings();
  },
  panels: [
    { id: PANEL_ID, slot: 'right-sidebar', get label() { return t('addons:assistant.plugin.panel'); }, component: AssistantPanel },
  ],
  menuItems: [
    {
      id: 'ai-assistant-open',
      section: 'Tools',
      get label() { return t('addons:assistant.plugin.menu'); },
      action: () => document.dispatchEvent(
        new CustomEvent(PLUGIN_PANEL_OPEN_EVENT, { detail: { panelId: PANEL_ID } }),
      ),
    },
  ],
};

export default aiAssistant;
