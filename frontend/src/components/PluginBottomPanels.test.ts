/**
 * The bottom-panel and status-bar slots: plugin panels registered for them are
 * drawn, given the editor, and nothing is drawn without them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Editor } from '@tiptap/react';
import '../i18n';
import { pluginRegistry, type PluginPanelProps } from '../plugins/registry';
import { PluginBottomPanels, PluginStatusBarItems } from './PluginBottomPanels';

const editor = { marker: 'the-editor' } as unknown as Editor;
const ShowsEditor = ({ editor: e }: PluginPanelProps) =>
  createElement('span', null, (e as unknown as { marker: string } | null)?.marker ?? 'no-editor');

afterEach(() => {
  pluginRegistry.unregister('bottom-test');
});

describe('plugin bottom panels', () => {
  it('draws nothing while no plugin has a bottom panel', () => {
    expect(renderToStaticMarkup(createElement(PluginBottomPanels, { editor }))).toBe('');
  });

  it('shows a tab for each bottom panel, with the panel closed', () => {
    pluginRegistry.register({
      id: 'bottom-test', name: 'Bottom test', version: '1.0.0',
      panels: [
        { id: 'log', slot: 'bottom-panel', label: 'Log', component: ShowsEditor },
        { id: 'side', slot: 'right-sidebar', label: 'Side', component: ShowsEditor },
      ],
    });
    const html = renderToStaticMarkup(createElement(PluginBottomPanels, { editor }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('>Log</button>');
    expect(html).not.toContain('Side');
    // Closed: the panel's content is not rendered yet.
    expect(html).not.toContain('the-editor');
  });

  it('gives status-bar items the editor', () => {
    pluginRegistry.register({
      id: 'bottom-test', name: 'Bottom test', version: '1.0.0',
      panels: [{ id: 'count', slot: 'status-bar', label: 'Count', component: ShowsEditor }],
    });
    expect(renderToStaticMarkup(createElement(PluginStatusBarItems, { editor }))).toBe('<span>the-editor</span>');
  });
});
