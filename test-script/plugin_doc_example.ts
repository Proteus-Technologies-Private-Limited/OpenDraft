// Type-checks the minimal plugin from docs/PLUGIN_DEVELOPMENT.md against the real registry types.
import { pluginRegistry, type OpenDraftPlugin } from '../frontend/src/plugins/registry';

const plugin: OpenDraftPlugin = {
  id: 'word-count-report',
  name: 'Word Count Report',
  version: '0.1.0',
  reports: [{
    id: 'word-count',
    label: 'Words per scene',
    build: ({ doc, title }) => ({
      title: `${title} — words per scene`,
      columns: ['Scene', 'Words'],
      rows: [],
    }),
  }],
};

pluginRegistry.register(plugin);
