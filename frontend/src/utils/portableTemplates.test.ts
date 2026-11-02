import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import { INDUSTRY_STANDARD_TEMPLATE } from '../stores/industryStandardTemplate';
import {
  createDefaultRule,
  type FormattingTemplate,
} from '../stores/formattingTypes';
import {
  useFormattingTemplateStore,
  activeTemplateSnapshot,
  templateForSavedContent,
  subscribeActiveTemplate,
} from '../stores/formattingTemplateStore';
import { useEditorStore } from '../stores/editorStore';
import { buildSaveContent } from './saveContent';
import { hydrateEditorStoresFromContent } from './hydrateStores';
import { serializeContentForFormat } from './linkedFileFormat';
import { parseOdraft } from './odraftFormat';
import { numberingRulesForSaved } from './elementNumbers';
import { parseTemplateSnapshot, sameTemplateDefinition } from './templateSnapshot';
import { generateTemplateCss } from './templateCss';
vi.mock('../services/api', () => ({
  api: {
    listFormattingTemplates: vi.fn(async () => []),
    createFormattingTemplate: vi.fn(),
    updateFormattingTemplate: vi.fn(),
    deleteFormattingTemplate: vi.fn(),
  },
}));
export function customFormat(id = 'my-format'): FormattingTemplate {
  const rule = createDefaultRule('sound-cue', 'Sound Cue', false);
  return {
    ...structuredClone(INDUSTRY_STANDARD_TEMPLATE),
    id,
    name: 'Audio drama',
    category: 'user',
    rules: {
      ...structuredClone(INDUSTRY_STANDARD_TEMPLATE.rules),
      [rule.id]: {
        ...rule,
        fontFamily: 'Arial',
        leftIndent: 2,
        marginTop: 24,
        bold: true,
        numbering: {
          enabled: true,
          resetOn: ['sceneHeading'],
          prefix: 'SFX ',
          startAt: 3,
        },
      },
    },
    pageLayout: {
      pageWidth: 8.5,
      pageHeight: 11,
      leftMargin: 1,
      rightMargin: 1,
    },
    forceBreakBefore: ['sound-cue'],
    lineHeightMultiplier: { dialogue: 2 },
    pageTimeSeconds: 30,
    titlePageFields: ['title', 'author'],
    starterDocument: [
      {
        type: 'customElement',
        attrs: { customTypeId: 'sound-cue' },
        content: [{ type: 'text', text: 'A cue' }],
      },
    ],
    scriptTypeGroup: 'Audio',
    scriptTypeTagline: 'Production draft',
  };
}
const editor = {
  isDestroyed: false,
  getJSON: () => ({
    type: 'doc',
    content: [
      {
        type: 'customElement',
        attrs: { customTypeId: 'sound-cue' },
        content: [{ type: 'text', text: 'Wind rises.' }],
      },
    ],
  }),
} as unknown as Editor;
beforeEach(() => {
  useFormattingTemplateStore.setState({
    templates: [],
    activeTemplateId: null,
    documentTemplate: null,
    loaded: false,
  });
});
describe('portable document templates', () => {
  it('saves a detached complete custom format and restores it on a clean device', () => {
    const format = customFormat();
    useFormattingTemplateStore.setState({
      templates: [format],
      activeTemplateId: format.id,
    });
    const saved = buildSaveContent(editor)!;
    expect(saved._templateSnapshot).toEqual(format);
    format.rules['sound-cue'].label = 'Later library edit';
    expect(
      (saved._templateSnapshot as FormattingTemplate).rules['sound-cue'].label,
    ).toBe('Sound Cue');
    const copy = parseOdraft(
      serializeContentForFormat('odraft', saved, 'Audio'),
    );
    useFormattingTemplateStore.setState({
      templates: [],
      activeTemplateId: null,
    });
    expect(hydrateEditorStoresFromContent(copy.content)).toBe(true);
    const store = useFormattingTemplateStore.getState();
    const active = store.getActiveTemplate();
    expect(active.rules['sound-cue']).toMatchObject({
      label: 'Sound Cue',
      fontFamily: 'Arial',
      leftIndent: 2,
      marginTop: 24,
    });
    expect(active.forceBreakBefore).toEqual(['sound-cue']);
    expect(active.lineHeightMultiplier).toEqual({ dialogue: 2 });
    expect(active.starterDocument).toEqual(customFormat().starterDocument);
    expect(active.pageTimeSeconds).toBe(30);
    expect(store.templates).toEqual([]);
    expect(store.getActiveTemplate()).toBe(active);
    expect(numberingRulesForSaved(copy.content)['sound-cue'].prefix).toBe(
      'SFX ',
    );
    const fdx = serializeContentForFormat('fdx', saved, 'Audio');
    expect(fdx).toContain('SFX 3');
  });
  it('prefers the same-id library format without losing fidelity warnings', () => {
    const local = customFormat();
    local.rules['sound-cue'].fontFamily = 'Georgia';
    useFormattingTemplateStore.setState({ templates: [local] });
    const incoming = customFormat();
    const fidelity = {
      format: 'osf',
      warnings: ['Unsupported source setting retained for save review'],
      uncertain: true,
    };
    expect(hydrateEditorStoresFromContent({
      _templateId: incoming.id,
      _templateSnapshot: JSON.stringify(incoming),
      _sourceFidelity: fidelity,
    })).toBe(true);
    const store = useFormattingTemplateStore.getState();
    expect(store.getActiveTemplate().rules['sound-cue'].fontFamily).toBe('Georgia');
    expect(store.documentTemplate?.id).toBe(incoming.id);
    expect(store.templates[0].rules['sound-cue'].fontFamily).toBe('Georgia');
    expect(useEditorStore.getState().sourceFidelity).toEqual(fidelity);
    expect(buildSaveContent(editor)?._templateSnapshot).toEqual(local);
  });
  it('keeps a same-id local template and another document independent', async () => {
    const own = customFormat();
    own.name = 'My local copy';
    useFormattingTemplateStore.setState({ templates: [own] });
    const incoming = customFormat();
    incoming.rules['sound-cue'].fontFamily = 'Georgia';
    useFormattingTemplateStore
      .getState()
      .restoreDocumentTemplate(incoming.id, incoming);
    expect(
      useFormattingTemplateStore.getState().getActiveTemplate().rules[
        'sound-cue'
      ].fontFamily,
    ).toBe('Arial');
    await useFormattingTemplateStore
      .getState()
      .updateTemplate(own.id, { name: 'Local edit' });
    expect(useFormattingTemplateStore.getState().getActiveTemplate().name).toBe(
      'Local edit',
    );
    expect(useFormattingTemplateStore.getState().templates[0].name).toBe(
      'Local edit',
    );
    expect(templateForSavedContent({ _templateId: own.id, _templateSnapshot: incoming })?.name).toBe('Local edit');
    useFormattingTemplateStore.getState().restoreDocumentTemplate(own.id);
    expect(useFormattingTemplateStore.getState().documentTemplate).toBeNull();
    expect(useFormattingTemplateStore.getState().getActiveTemplate().name).toBe(
      'Local edit',
    );
    useFormattingTemplateStore.getState().restoreDocumentTemplate(null);
    expect(useFormattingTemplateStore.getState().getActiveTemplate()).toBe(
      INDUSTRY_STANDARD_TEMPLATE,
    );
  });
  it('does not lose the document format when library loading finishes later', async () => {
    const format = customFormat();
    useFormattingTemplateStore
      .getState()
      .restoreDocumentTemplate(format.id, format);
    const active = useFormattingTemplateStore.getState().getActiveTemplate();
    await useFormattingTemplateStore.getState().loadTemplates();
    expect(useFormattingTemplateStore.getState().getActiveTemplate()).toBe(
      active,
    );
  });
  it('edits a document format without changing earlier saves or the library', () => {
    const format = customFormat();
    useFormattingTemplateStore.setState({ templates: [customFormat('library-format')] });
    useFormattingTemplateStore
      .getState()
      .restoreDocumentTemplate(format.id, format);
    const before = buildSaveContent(editor)!;
    const edited = structuredClone(
      useFormattingTemplateStore.getState().getActiveTemplate(),
    );
    edited.rules['sound-cue'].leftIndent = 2.75;
    useFormattingTemplateStore
      .getState()
      .restoreDocumentTemplate(edited.id, edited);
    expect(
      useFormattingTemplateStore.getState().getActiveTemplate().rules[
        'sound-cue'
      ].leftIndent,
    ).toBe(2.75);
    expect(
      useFormattingTemplateStore.getState().templates[0].rules['sound-cue']
        .leftIndent,
    ).toBe(2);
    expect(
      (before._templateSnapshot as FormattingTemplate).rules['sound-cue']
        .leftIndent,
    ).toBe(2);
    hydrateEditorStoresFromContent({ _notes: [] });
    expect(useFormattingTemplateStore.getState().documentTemplate).toBeNull();
  });
  it('notifies metadata saves for format-only changes and ignores unrelated library edits', () => {
    const format = customFormat();
    useFormattingTemplateStore
      .getState()
      .restoreDocumentTemplate(format.id, format);
    const saved: Record<string, unknown>[] = [];
    const stop = subscribeActiveTemplate(() => {
      saved.push(buildSaveContent(editor)!);
    });
    useFormattingTemplateStore.setState({
      templates: [customFormat('unrelated')],
    });
    expect(saved).toHaveLength(0);
    const changed = structuredClone(format);
    changed.rules['sound-cue'].marginTop = 36;
    useFormattingTemplateStore
      .getState()
      .restoreDocumentTemplate(changed.id, changed);
    expect(saved).toHaveLength(1);
    expect(
      (saved[0]._templateSnapshot as FormattingTemplate).rules['sound-cue']
        .marginTop,
    ).toBe(36);
    stop();
    useFormattingTemplateStore.getState().setActiveTemplateId(null);
    expect(saved).toHaveLength(1);
  });
  it('resolves background exports from the saved snapshot instead of the active document', () => {
    const snapshot = customFormat();
    const unrelated = customFormat('unrelated');
    unrelated.rules['sound-cue'].numbering!.prefix = 'OTHER ';
    useFormattingTemplateStore.setState({
      templates: [unrelated],
      activeTemplateId: unrelated.id,
    });
    expect(
      numberingRulesForSaved({
        _templateId: snapshot.id,
        _templateSnapshot: snapshot,
      })['sound-cue'].prefix,
    ).toBe('SFX ');
    expect(useFormattingTemplateStore.getState().getActiveTemplate().id).toBe(
      'unrelated',
    );
    expect(
      templateForSavedContent({
        _templateId: snapshot.id,
        _templateSnapshot: snapshot,
      })?.forceBreakBefore,
    ).toEqual(['sound-cue']);
  });
  it('keeps built-ins unchanged and excludes their redundant snapshots', () => {
    const builtin = INDUSTRY_STANDARD_TEMPLATE;
    useFormattingTemplateStore.getState().restoreDocumentTemplate(builtin.id, {
      ...customFormat(builtin.id),
      name: 'Imposter',
    });
    expect(useFormattingTemplateStore.getState().getActiveTemplate()).toBe(
      builtin,
    );
    expect(activeTemplateSnapshot()).toBeNull();
    expect(buildSaveContent(editor)).not.toHaveProperty('_templateSnapshot');
  });
  it('accepts serialized snapshots, rejects malformed or mismatched ones and preserves legacy id-only lookup', () => {
    const f = customFormat();
    expect(
      parseTemplateSnapshot(JSON.stringify(f), f.id)?.rules['titlePage:title'],
    ).toBeDefined();
    expect(parseTemplateSnapshot(f, 'different')).toBeNull();
    expect(
      parseTemplateSnapshot(
        {
          ...f,
          rules: {
            x: { id: 'x', label: 'Bad', isBuiltIn: false, leftIndent: 'bad' },
          },
        },
        f.id,
      ),
    ).toBeNull();
    expect(
      parseTemplateSnapshot(
        {
          ...f,
          rules: {
            ...f.rules,
            'sound-cue': {
              ...f.rules['sound-cue'],
              textColor: 'red;display:none',
            },
          },
        },
        f.id,
      ),
    ).toBeNull();
    useFormattingTemplateStore.setState({ templates: [f] });
    expect(templateForSavedContent({ _templateId: f.id })).toBe(f);
  });
  it('restores custom rules into the same stylesheet model used by the editor', () => {
    const f = customFormat();
    useFormattingTemplateStore.getState().restoreDocumentTemplate(f.id, f);
    const css = generateTemplateCss(
      useFormattingTemplateStore.getState().getActiveTemplate(),
      useEditorStore.getState().pageLayout,
    );
    expect(css).toContain('sound-cue');
    expect(css).toContain('font-family:');
    expect(css).toContain('24pt');
  });
});

it('does not autosave when the legacy template library arrives, then observes actual library edits', async () => {
  const { api } = await import('../services/api');
  const source = api as unknown as { listFormattingTemplates: () => Promise<FormattingTemplate[]> };
  const f = customFormat();
  vi.spyOn(source, 'listFormattingTemplates').mockResolvedValueOnce([f]);
  useFormattingTemplateStore.getState().restoreDocumentTemplate(f.id);
  const saved = vi.fn();
  const stop = subscribeActiveTemplate(saved);
  try {
    await useFormattingTemplateStore.getState().loadTemplates();
    expect(useFormattingTemplateStore.getState().getActiveTemplate().id).toBe(f.id);
    expect(saved).not.toHaveBeenCalled();
    await useFormattingTemplateStore.getState().updateTemplate(f.id, { name: 'Edited library format' });
    expect(saved).toHaveBeenCalledTimes(1);
    expect(useFormattingTemplateStore.getState().getActiveTemplate().name).toBe('Edited library format');
    const same = structuredClone(useFormattingTemplateStore.getState().templates);
    useFormattingTemplateStore.setState({ templates: same });
    expect(saved).toHaveBeenCalledTimes(1);
  } finally { stop(); }
});

it('recognizes identical definitions despite timestamps and key order', () => {
  const a = customFormat();
  const b = structuredClone(a);
  b.createdAt = 'other'; b.updatedAt = 'new';
  b.rules = Object.fromEntries(Object.entries(b.rules).reverse());
  expect(sameTemplateDefinition(a, b)).toBe(true);
  b.rules.action.bold = !b.rules.action.bold;
  expect(sameTemplateDefinition(a, b)).toBe(false);
});

it('restores legacy OSF snapshots as one document format without inserting a library template', async () => {
  const { importedFormat, restoreImportedFormat } = await import('./importedFormat');
  const snapshot = importedFormat({ action: { bold: true } });
  restoreImportedFormat(snapshot);
  expect(useFormattingTemplateStore.getState().getActiveTemplate().rules.action.bold).toBe(true);
  expect(useFormattingTemplateStore.getState().templates).toEqual([]);
  hydrateEditorStoresFromContent({ _templateSnapshot: snapshot });
  expect(useFormattingTemplateStore.getState().documentTemplate?.id).toBe(snapshot.id);
  expect(useFormattingTemplateStore.getState().templates).toEqual([]);
});

it.each([
  { starterDocument: [null] },
  { starterDocument: [{ type: 'unknownNode' }] },
  { starterDocument: [{ type: 'action', content: 'wrong' }] },
  { starterDocument: [{ type: 'text', text: 'not a block' }] },
  { starterDocument: [{ type: 'action', attrs: { size: Infinity } }] },
  { pageLayout: { pageWidth: 'wide' } },
  { pageLayout: { pageWidth: 0 } },
  { pageLayout: { pageWidth: 2, leftMargin: 2, rightMargin: 1 } },
  { pageLayout: { moresContds: { dialogueBreakContd: 'yes' } } },
  { pageLayout: { footnotes: { startAt: -2 } } },
])('rejects malformed starter content or layout: %j', patch => {
  const f = { ...customFormat(), ...patch };
  expect(parseTemplateSnapshot(f, f.id)).toBeNull();
  expect(useFormattingTemplateStore.getState().restoreDocumentTemplate(f.id, f)).toBe(false);
});

it('rejects unknown rule properties instead of retaining them in snapshots', () => {
  const f = customFormat();
  Object.assign(f.rules.action, { arbitraryRuleProperty: true });
  expect(parseTemplateSnapshot(f, f.id)).toBeNull();
});
