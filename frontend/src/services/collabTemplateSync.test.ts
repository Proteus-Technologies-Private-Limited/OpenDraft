import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { startCollabSync, stopCollabSync } from './collabSync';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { useEditorStore, DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import { INDUSTRY_STANDARD_TEMPLATE } from '../stores/industryStandardTemplate';
import type { FormattingTemplate } from '../stores/formattingTypes';
const format = (name = 'Incoming'): FormattingTemplate => ({
  ...structuredClone(INDUSTRY_STANDARD_TEMPLATE),
  id: 'same-id',
  name,
  category: 'user',
  rules: {
    ...structuredClone(INDUSTRY_STANDARD_TEMPLATE.rules),
    dialogue: {
      ...INDUSTRY_STANDARD_TEMPLATE.rules.dialogue,
      leftIndent: 2.2,
      numbering: { enabled: true, resetOn: [], prefix: 'LINE ' },
    },
  },
});
const packet = (template: FormattingTemplate | null) =>
  JSON.stringify({
    _templateId: template?.id ?? null,
    ...(template ? { _templateSnapshot: template } : {}),
    _pageLayout: { ...DEFAULT_PAGE_LAYOUT, pageWidth: 8.5, rightMargin: 1 },
    _sceneHeadingSpaceBefore: null,
  });
let mine: Y.Doc;
let peer: Y.Doc;
const exchange = () =>
  Y.applyUpdate(
    mine,
    Y.encodeStateAsUpdate(peer, Y.encodeStateVector(mine)),
    'remote',
  );
beforeEach(() => {
  mine = new Y.Doc();
  peer = new Y.Doc();
  useFormattingTemplateStore.setState({
    templates: [],
    activeTemplateId: null,
    documentTemplate: null,
  });
  useEditorStore.setState({ pageLayout: DEFAULT_PAGE_LAYOUT });
});
afterEach(() => {
  stopCollabSync();
  mine.destroy();
  peer.destroy();
});
describe('collaboration document format', () => {
  it('seeds the host custom format and geometry as one shared packet', () => {
    const template = format();
    useFormattingTemplateStore.setState({
      templates: [template],
      activeTemplateId: template.id,
    });
    startCollabSync(mine, true);
    const shared = JSON.parse(
      mine.getMap<string>('metadata').get('documentFormat')!,
    );
    expect(shared._templateId).toBe(template.id);
    expect(shared._templateSnapshot.rules.dialogue.numbering.prefix).toBe(
      'LINE ',
    );
    expect(shared._pageLayout).toEqual(DEFAULT_PAGE_LAYOUT);
  });
  it('restores a joining guest without replacing its same-id library template', () => {
    const own = format('Local');
    useFormattingTemplateStore.setState({
      templates: [own],
      activeTemplateId: own.id,
    });
    peer.getMap<string>('metadata').set('documentFormat', packet(format()));
    exchange();
    startCollabSync(mine, false);
    const store = useFormattingTemplateStore.getState();
    expect(store.getActiveTemplate().name).toBe('Incoming');
    expect(store.templates[0]).toBe(own);
    expect(useEditorStore.getState().pageLayout.pageWidth).toBe(8.5);
    const active = store.getActiveTemplate();
    peer.getMap<string>('metadata').set('beats', '[]');
    exchange();
    expect(useFormattingTemplateStore.getState().getActiveTemplate()).toBe(
      active,
    );
  });
  it('publishes format changes from the template store and clears snapshots on a switch to a built-in', () => {
    startCollabSync(mine, true);
    useFormattingTemplateStore
      .getState()
      .restoreDocumentTemplate('same-id', format());
    expect(
      JSON.parse(mine.getMap<string>('metadata').get('documentFormat')!)
        ._templateSnapshot.name,
    ).toBe('Incoming');
    useFormattingTemplateStore.getState().setActiveTemplateId(null);
    expect(
      JSON.parse(mine.getMap<string>('metadata').get('documentFormat')!),
    ).not.toHaveProperty('_templateSnapshot');
  });
  it('ignores malformed remote definitions and does not leak a guest format into legacy sessions', () => {
    useFormattingTemplateStore.setState({
      templates: [format('Local')],
      activeTemplateId: 'same-id',
    });
    startCollabSync(mine, false);
    useEditorStore.getState().setBeatArrangeMode('custom');
    expect(mine.getMap('metadata').has('documentFormat')).toBe(false);
    peer
      .getMap<string>('metadata')
      .set(
        'documentFormat',
        JSON.stringify({
          _templateId: 'same-id',
          _templateSnapshot: { id: 'wrong' },
        }),
      );
    exchange();
    expect(useFormattingTemplateStore.getState().getActiveTemplate().name).toBe(
      'Local',
    );
  });
  it('stops listening to template changes after leaving collaboration', () => {
    startCollabSync(mine, true);
    const saved = mine.getMap<string>('metadata').get('documentFormat');
    stopCollabSync();
    useFormattingTemplateStore
      .getState()
      .restoreDocumentTemplate('same-id', format());
    expect(mine.getMap<string>('metadata').get('documentFormat')).toBe(saved);
  });
});
