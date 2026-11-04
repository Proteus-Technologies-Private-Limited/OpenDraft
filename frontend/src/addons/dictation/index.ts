import { createElement } from 'react';
import { FaMicrophone } from 'react-icons/fa';
import type { OpenDraftPlugin } from '../../plugins/registry';
import { PLUGIN_PANEL_OPEN_EVENT } from '../../components/PluginPanelTabs';
import DictationPanel from './panel';
import DictationSettingsForm from './DictationSettingsForm';
import { forgetSettings } from './settings';
import { stopDictation } from './lifecycle';
import { disposeLocalRecognition } from './services/local';
const dictation: OpenDraftPlugin = {
  id: 'dictation', name: 'Dictation', version: '1.0.0', optIn: true,
  description: 'Dictate a short phrase, review the transcript, then insert it into your screenplay. Optional English voice commands start new elements.',
  privacy: 'Local Whisper keeps audio on this device. First use downloads model assets from huggingface.co, which sees your IP address. Browser speech recognition may send recorded voice to Google, Apple or Microsoft. Device recognition may send recorded voice to Apple or the Android speech provider (usually Google). On-device recognition is requested where supported; Android’s offline preference is not a guarantee. Choose the engine below before turning dictation on. Preferences stay on this device and can be deleted when the add-on is turned off.',
  settings: DictationSettingsForm,
  onDeactivate: ({ forgetSettings: forget }) => {
    stopDictation(); disposeLocalRecognition();
    if (forget) forgetSettings();
  },
  panels: [{ id: 'dictation-panel', slot: 'right-sidebar', label: 'Dictation', component: DictationPanel }],
  menuItems: [{
    id: 'dictation-open', section: 'Tools', label: 'Dictation…', icon: createElement(FaMicrophone), order: 10,
    disabled: ({ editor }) => !editor || !editor.isEditable,
    action: () => document.dispatchEvent(new CustomEvent(PLUGIN_PANEL_OPEN_EVENT, { detail: { panelId: 'dictation-panel' } })),
  }],
};
export default dictation;
