import { createElement } from 'react';
import { FaMicrophone } from 'react-icons/fa';
import type { OpenDraftPlugin } from '../../plugins/registry';
import { PLUGIN_PANEL_OPEN_EVENT } from '../../components/PluginPanelTabs';
import { t } from '../../i18n';
import DictationPanel from './panel';
import DictationSettingsForm from './DictationSettingsForm';
import { forgetSettings } from './settings';
import { stopDictation } from './lifecycle';
import { disposeLocalRecognition } from './services/local';
const dictation: OpenDraftPlugin = {
  id: 'dictation', version: '1.0.0', optIn: true,
  // Getters, so the text is looked up when it is shown and follows the interface language.
  get name() { return t('addons:dictation.plugin.name'); },
  get description() { return t('addons:dictation.plugin.description'); },
  get privacy() { return t('addons:dictation.plugin.privacy'); },
  settings: DictationSettingsForm,
  onDeactivate: ({ forgetSettings: forget }) => {
    stopDictation(); disposeLocalRecognition();
    if (forget) forgetSettings();
  },
  panels: [{ id: 'dictation-panel', slot: 'right-sidebar', get label() { return t('addons:dictation.plugin.name'); }, component: DictationPanel }],
  menuItems: [{
    id: 'dictation-open', section: 'Tools', get label() { return t('addons:dictation.plugin.menu'); }, icon: createElement(FaMicrophone), order: 10,
    disabled: ({ editor }) => !editor || !editor.isEditable,
    action: () => document.dispatchEvent(new CustomEvent(PLUGIN_PANEL_OPEN_EVENT, { detail: { panelId: 'dictation-panel' } })),
  }],
};
export default dictation;
