import { describe, expect, it } from 'vitest';
import { block, doc, testSchema } from '../test/screenplaySchema';
import { useEditorStore } from '../stores/editorStore';
import { readCustomTitleFields, titlePageTextLines } from './customTitlePage';
import { exportFountain } from './fountainExporter';
import { parseFountain } from './fountainParser';
import { jsonBlockText } from './nodeText';
import { parseOdraft } from './odraftFormat';
import { serializeContentForFormat } from './linkedFileFormat';
import { buildTitlePageBlocks, customizeTitlePageBlocks, trimCustomTitlePage, type TpData } from './titlePageDialogBlocks';
import { findTitlePageRegion, titlePageNodeInfo } from './titlePageRegion';

const standard: TpData = {
  tpTitle: 'A Quiet Beacon',
  tpCredit: '',
  tpWrittenBy: 'Taylor Example',
  tpBasedOn: '',
  tpDraft: 'Revision 2',
  tpDraftDate: 'January 15, 2026',
  tpContact: '',
  tpCopyright: '',
  tpWgaRegistration: '',
  tpNotes: '',
  tpTitleFontSize: 12,
};

const customBlock = (field: string, text: string) => ({
  ...block('titlePage', text),
  attrs: { field, tpCustom: true, tpAlign: 'right' },
});

describe('custom title pages', () => {
  it('separates standard draft and credit fields without losing directly edited text', () => {
    const schema = testSchema;
    const source = { state: { schema, doc: schema.nodeFromJSON(doc(block('action', 'Scene text.'))) } };
    const base = buildTitlePageBlocks(source, standard, [], [], 54);
    const title = base.findIndex(node => node.attrs.field === 'title');
    base[title] = base[title].copy(schema.nodes.titlePage.create(null, schema.text('Edited title')).content);
    const custom = customizeTitlePageBlocks(base, schema, standard);

    expect(readCustomTitleFields(custom.map(node => node.toJSON()))).toMatchObject({
      tpTitle: 'Edited title',
      tpCredit: 'Written by',
      tpWrittenBy: 'Taylor Example',
      tpDraft: 'Revision 2',
      tpDraftDate: 'January 15, 2026',
    });
    const spacer = schema.nodes.titlePage.create({ field: 'blank', tpCustom: true });
    expect(trimCustomTitlePage([...custom, spacer])).toEqual(custom);
  });

  it('keeps a nearby body image outside the custom page', () => {
    const nodes = [
      customBlock('draft', 'Revision 3'),
      { type: 'screenplayImage', attrs: { tpCustom: true } },
      block('action', 'Scene text.'),
      { type: 'screenplayImage' },
    ];
    const region = findTitlePageRegion(nodes.map(node =>
      titlePageNodeInfo(node.type ?? '', jsonBlockText(node), node.attrs),
    ));
    expect(region).toEqual({ length: 2, isReal: true });
  });

  it('keeps custom layout in OpenDraft and the visible field text in Fountain', () => {
    const page = [
      customBlock('draft', 'Revision 3'),
      customBlock('draftDate', 'January 15, 2026'),
      customBlock('blank', 'For production\n\nCopy 4'),
    ];
    const body = block('action', 'The lighthouse stays dark.');
    const screenplay = doc(...page, body);
    const saved = parseOdraft(serializeContentForFormat('odraft', screenplay, 'Test')).content;
    expect(saved.content).toEqual(screenplay.content);

    const fountain = exportFountain(screenplay);
    expect(fountain).toContain('Draft: Revision 3\nDraft date: January 15, 2026\nNotes: For production\n    Copy 4');
    const reopened = parseFountain(fountain);
    expect(reopened.content?.find(node => node.attrs?.field === 'title')?.attrs).toMatchObject({
      tpDraft: 'Revision 3',
      tpDraftDate: 'January 15, 2026',
      tpNotes: 'For production\nCopy 4',
    });
    expect(reopened.content?.at(-1)).toMatchObject(body);
  });

  it('wraps long text and preserves explicit blank lines on the custom page', () => {
    expect(titlePageTextLines('One two three\n\nFour', 0.8, 12)).toEqual(['One two', 'three', '', 'Four']);
  });
});

describe('Notes panel tab', () => {
  it('keeps the last tab when toggling after using an explicit script-note command', () => {
    const state = useEditorStore.getState();
    state.setNoteFilter({ elementType: null, contextLabel: null, color: null, noteId: 'example' });
    expect(useEditorStore.getState().notesActiveTab).toBe('script');
    state.setNotesActiveTab('general');
    state.toggleScriptNotes();
    state.toggleScriptNotes();
    expect(useEditorStore.getState().notesActiveTab).toBe('general');
    expect(useEditorStore.getState().notes).toEqual(state.notes);
  });
});
