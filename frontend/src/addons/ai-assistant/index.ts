/**
 * AI Assistant: an opt-in add-on, off until the writer turns it on.
 *
 * Everything the app sees of it is declared here. The Tools menu item opens the
 * sidebar panel by dispatching `plugin-panel:open`; it does not reach into the
 * editor, the toolbar or the menus, so turning the add-on off removes all of it.
 */
import type { OpenDraftPlugin } from '../../plugins/registry';
import { PLUGIN_PANEL_OPEN_EVENT } from '../../components/PluginPanelTabs';
import AssistantPanel from './AssistantPanel';
import AssistantSettingsForm from './AssistantSettingsForm';
import { forgetSettings } from './settingsStore';

const PANEL_ID = 'ai-assistant-panel';

const aiAssistant: OpenDraftPlugin = {
  id: 'ai-assistant',
  name: 'AI Assistant',
  version: '1.0.0',
  optIn: true,
  description:
    'Ask an AI model about your script and insert its suggestions after you review them. '
    + 'Works with a local server such as Ollama, LM Studio or Unsloth Studio.',
  privacy:
    'Sends your question, the script context it needs to answer, and the text you select to the AI '
    + 'server you choose. With a local server such as Ollama, LM Studio or Unsloth Studio on your own '
    + 'computer, nothing leaves your device. The server address, model name and any API key are stored '
    + 'on this device only, never in scripts.',
  settings: AssistantSettingsForm,
  onDeactivate: ({ forgetSettings: forget }) => {
    if (forget) forgetSettings();
  },
  panels: [
    { id: PANEL_ID, slot: 'right-sidebar', label: 'Assistant', component: AssistantPanel },
  ],
  menuItems: [
    {
      id: 'ai-assistant-open',
      section: 'Tools',
      label: 'AI Assistant…',
      action: () => document.dispatchEvent(
        new CustomEvent(PLUGIN_PANEL_OPEN_EVENT, { detail: { panelId: PANEL_ID } }),
      ),
    },
  ],
};

export default aiAssistant;
