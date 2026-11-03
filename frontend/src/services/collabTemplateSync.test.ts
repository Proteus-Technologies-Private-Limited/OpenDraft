import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { startCollabSync, stopCollabSync } from './collabSync';
import { useFormattingTemplateStore, applyDocumentTemplate } from '../stores/formattingTemplateStore';
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
    unreadableTemplateSnapshot: null,
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
    expect(store.getActiveTemplate().name).toBe('Local');
    expect(store.documentTemplate?.name).toBe('Incoming');
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

it('keeps a guest’s document edit when the host has the original library ID', () => {
  const original = format('Host library');
  peer.getMap<string>('metadata').set('documentFormat', packet(original));
  exchange(); startCollabSync(mine, false);
  const edited = structuredClone(useFormattingTemplateStore.getState().getActiveTemplate());
  edited.rules.action.bold = true;
  expect(applyDocumentTemplate(edited)).toBe(true);
  const guestId = useFormattingTemplateStore.getState().activeTemplateId;
  expect(guestId).not.toBe(original.id);
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(mine, Y.encodeStateVector(peer)), 'remote');
  stopCollabSync();
  useFormattingTemplateStore.setState({ templates: [original], activeTemplateId: original.id, documentTemplate: null, unreadableTemplateSnapshot: null });
  startCollabSync(peer, false);
  expect(useFormattingTemplateStore.getState().activeTemplateId).toBe(guestId);
  expect(useFormattingTemplateStore.getState().getActiveTemplate().rules.action.bold).toBe(true);
  expect(original.rules.action.bold).toBe(false);
});

it('preserves the shared format when a same-ID library conflict only changes margins', () => {
  const local = format('Different guest library');
  local.rules.action.bold = true;
  useFormattingTemplateStore.setState({ templates: [local] });
  const shared = format('Host document');
  peer.getMap<string>('metadata').set('documentFormat', packet(shared));
  exchange(); startCollabSync(mine, false);
  expect(useFormattingTemplateStore.getState().getActiveTemplate().name).toBe('Different guest library');
  useEditorStore.getState().setPageLayout({ ...useEditorStore.getState().pageLayout, rightMargin: 1.5 });
  const published = JSON.parse(mine.getMap<string>('metadata').get('documentFormat')!);
  expect(published._templateSnapshot).toEqual(shared);
  expect(published._pageLayout.rightMargin).toBe(1.5);
  expect(published._templateId).toBe(shared.id);
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(mine, Y.encodeStateVector(peer)), 'remote');
  stopCollabSync();
  useFormattingTemplateStore.setState({ templates: [], activeTemplateId: null, documentTemplate: null, unreadableTemplateSnapshot: null });
  startCollabSync(peer, false);
  expect(useFormattingTemplateStore.getState().getActiveTemplate().name).toBe('Host document');
  expect(useFormattingTemplateStore.getState().getActiveTemplate().rules.action.bold).toBe(false);
  expect(useEditorStore.getState().pageLayout.rightMargin).toBe(1.5);
});

it('retains an unsupported remote snapshot through later layout edits', () => {
  const unknown = { ...format('Future'), futureFormatProperty: { version: 99 } };
  // A future rule key is deliberately unreadable in this version.
  Object.assign(unknown.rules.action, { futureRuleProperty: true });
  peer.getMap<string>('metadata').set('documentFormat', packet(unknown));
  exchange(); startCollabSync(mine, false);
  expect(useFormattingTemplateStore.getState().documentTemplate).toBeNull();
  expect(useFormattingTemplateStore.getState().unreadableTemplateSnapshot).toEqual(unknown);
  useEditorStore.getState().setPageLayout({ ...DEFAULT_PAGE_LAYOUT, rightMargin: 1.4 });
  const published = JSON.parse(mine.getMap<string>('metadata').get('documentFormat')!);
  expect(published._templateSnapshot).toEqual(unknown);
  expect(published._pageLayout.rightMargin).toBe(1.4);
});

it('does not throw on a layout edit after malformed shared metadata', () => {
  const local = format('Local');
  useFormattingTemplateStore.setState({ templates: [local], activeTemplateId: local.id });
  startCollabSync(mine, true);
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(mine), 'remote');
  peer.getMap<string>('metadata').set('documentFormat', 'not JSON');
  exchange();
  expect(() => useEditorStore.getState().setPageLayout({ ...DEFAULT_PAGE_LAYOUT, rightMargin: 1.2 })).not.toThrow();
  const published = JSON.parse(mine.getMap<string>('metadata').get('documentFormat')!);
  expect(published._templateSnapshot).toEqual(local);
  expect(published._pageLayout.rightMargin).toBe(1.2);
});

it.each(['suggester', 'viewer'])(
  'receives the host format without publishing local changes as a %s',
  (role) => {
    const shared = packet(format('Host format'));
    peer.getMap<string>('metadata').set('documentFormat', shared);
    exchange();
    startCollabSync(mine, false, () => role === 'editor');

    expect(useFormattingTemplateStore.getState().getActiveTemplate().name).toBe('Host format');
    expect(applyDocumentTemplate(format('Private change'))).toBe(true);
    useEditorStore.getState().setPageLayout({
      ...DEFAULT_PAGE_LAYOUT,
      rightMargin: 2,
    });
    useEditorStore.getState().setSceneHeadingSpaceBefore(3);
    // Other metadata subscriptions must not smuggle the private format out.
    useEditorStore.getState().setBeatArrangeMode('custom');
    expect(mine.getMap<string>('metadata').get('documentFormat')).toBe(shared);
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(mine, Y.encodeStateVector(peer)), 'remote');
    expect(peer.getMap<string>('metadata').get('documentFormat')).toBe(shared);

    // Read-only participants must continue receiving later editor changes.
    peer.getMap<string>('metadata').set('documentFormat', packet(format('Updated host format')));
    exchange();
    expect(useFormattingTemplateStore.getState().getActiveTemplate().name).toBe('Updated host format');
    expect(useEditorStore.getState().pageLayout.rightMargin).toBe(1);
  },
);

it('keeps a restricted guest from publishing when the host format arrives after joining', () => {
  startCollabSync(mine, false, () => false);
  expect(applyDocumentTemplate(format('Private format'))).toBe(true);
  expect(mine.getMap('metadata').has('documentFormat')).toBe(false);

  const shared = packet(format('Host format'));
  peer.getMap<string>('metadata').set('documentFormat', shared);
  exchange();
  useEditorStore.getState().setPageLayout({ ...DEFAULT_PAGE_LAYOUT, rightMargin: 2 });
  expect(mine.getMap<string>('metadata').get('documentFormat')).toBe(shared);
});

it('checks the format permission on every publication and does not queue blocked changes', () => {
  let allowed = true;
  startCollabSync(mine, true, () => allowed);
  const initial = mine.getMap<string>('metadata').get('documentFormat');

  allowed = false;
  expect(applyDocumentTemplate(format('Private format'))).toBe(true);
  useEditorStore.getState().setPageLayout({ ...DEFAULT_PAGE_LAYOUT, rightMargin: 2 });
  expect(mine.getMap<string>('metadata').get('documentFormat')).toBe(initial);

  allowed = true;
  useEditorStore.getState().setBeatArrangeMode('custom');
  expect(mine.getMap<string>('metadata').get('documentFormat')).toBe(initial);

  useEditorStore.getState().setPageLayout({ ...DEFAULT_PAGE_LAYOUT, rightMargin: 1.4 });
  expect(JSON.parse(mine.getMap<string>('metadata').get('documentFormat')!)._pageLayout.rightMargin)
    .toBe(1.4);
});
