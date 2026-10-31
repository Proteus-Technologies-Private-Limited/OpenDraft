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
import { parseTemplateSnapshot } from './templateSnapshot';
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
    ).toBe('Georgia');
    await useFormattingTemplateStore
      .getState()
      .updateTemplate(own.id, { name: 'Local edit' });
    expect(useFormattingTemplateStore.getState().getActiveTemplate().name).toBe(
      'Audio drama',
    );
    expect(useFormattingTemplateStore.getState().templates[0].name).toBe(
      'Local edit',
    );
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
    useFormattingTemplateStore.setState({ templates: [format] });
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
