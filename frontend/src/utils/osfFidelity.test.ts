import { buildSaveContent } from './saveContent';
import { hydrateEditorStoresFromContent } from './hydrateStores';
import type { Editor } from '@tiptap/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import { parseOSF, parseFadeIn } from './osfParser';
import { exportOSF, exportFadeIn } from './osfExporter';
import { DEFAULT_PAGE_LAYOUT, useEditorStore } from '../stores/editorStore';
import { importedFormat, restoreImportedFormat } from './importedFormat';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { parseScreenplayImport } from './importScreenplay';
import { serializeContentForFormat } from './linkedFileFormat';
import {
  inchesToPoints,
  pointsToInches,
  inchesToOsf,
  osfToInches,
  osfToPoints,
} from './layoutUnits';
beforeAll(() => {
  Object.assign(globalThis, { DOMParser: XmlDOMParser });
});
function source(width = 2100, height = 2970) {
  return `<document version="40"><settings page_width="${width}" page_height="${height}" margin_left="390" margin_right="250" margin_top="200" margin_bottom="300" normal_linesperinch="5" element_spacing="1.25" vendor_flag="keep" scene_numbering="false"/><styles>
<style name="Normal Text" builtin_index="0" font="Courier" size="12" leftindent="0" rightindent="0" spacebefore="0"/>
<style name="Action" builtin_index="2" basestyle="Normal Text" leftindent="127" rightindent="100" spacebefore="1.5" align="center" bold="1" italic="1" underline="1" keepwithnext="1"/>
<style name="Dialogue" builtin_index="5" basestyle="Action" leftindent="-25"/>
</styles><titlepage><para bookmark="title"><text>TEST TITLE</text></para></titlepage><paragraphs><para><style basestyle="Action"/><text>Action text</text></para><para><style basestyle="Dialogue"/><text>Speech</text></para></paragraphs></document>`;
}
describe('source geometry and supported element rules', () => {
  it('uses documented Letter defaults and explicit conversions', () => {
    expect(DEFAULT_PAGE_LAYOUT).toMatchObject({
      pageWidth: 8.5,
      pageHeight: 11,
      leftMargin: 1.5,
      rightMargin: 1,
      topMargin: 72,
      bottomMargin: 72,
    });
    expect(inchesToPoints(1)).toBe(72);
    expect(pointsToInches(72)).toBe(1);
    expect(inchesToOsf(8.5)).toBe(2159);
    expect(osfToInches(2159)).toBe(8.5);
    expect(osfToPoints(254)).toBe(72);
  });
  for (const [width, height] of [
    [2100, 2970],
    [2159, 2794],
  ])
    it(`retains ${width}x${height} through repeated OSF and archive conversions`, async () => {
      let parsed = parseOSF(source(width, height));
      const first = parsed;
      expect(parsed.pageLayout?.pageWidth).toBeCloseTo(width / 254);
      expect(parsed.elementRules?.action).toMatchObject({
        bold: true,
        italic: true,
        underline: true,
        textAlign: 'center',
        marginTop: 18,
      });
      expect(parsed.elementRules?.dialogue?.leftIndent).toBeCloseTo(
        (390 - 25) / 254,
      );
      expect(parsed.elementRules?.dialogue?.bold).toBe(true);
      for (let pass = 0; pass < 3; pass++) {
        const options = {
          pageLayout: { ...DEFAULT_PAGE_LAYOUT, ...parsed.pageLayout },
          elementRules: importedFormat(parsed.elementRules ?? {}).rules,
        };
        parsed =
          pass % 2
            ? await parseFadeIn(
                (await exportFadeIn(parsed.doc, options)).slice()
                  .buffer as ArrayBuffer,
              )
            : parseOSF(exportOSF(parsed.doc, options));
        for (const key of [
          'pageWidth',
          'pageHeight',
          'leftMargin',
          'rightMargin',
          'topMargin',
          'bottomMargin',
        ] as const)
          expect(parsed.pageLayout?.[key]).toBeCloseTo(
            first.pageLayout![key]!,
            8,
          );
        expect(parsed.elementRules?.action).toMatchObject(
          first.elementRules!.action,
        );
        expect(parsed.pageLayout?.osfSource?.settings.vendor_flag).toBe('keep');
      }
    });
  it('carries imported formatting through library metadata and linked-file serialization', async () => {
    const imported = await parseScreenplayImport('script.osf', source(), {
      hydrateStores: false,
    });
    expect(imported.metadata?._sourceFidelity).toMatchObject({
      uncertain: true,
      format: 'osf',
    });
    const payload = { ...imported.doc, ...imported.metadata };
    const xml = serializeContentForFormat('osf', payload, 'Test');
    const read = parseOSF(xml);
    expect(read.pageLayout?.leftMargin).toBeCloseTo(390 / 254);
    expect(read.elementRules?.action?.marginTop).toBe(18);
    const template = imported.metadata!._templateSnapshot as ReturnType<
      typeof importedFormat
    >;
    useFormattingTemplateStore.setState({ templates: [] });
    restoreImportedFormat(JSON.parse(JSON.stringify(template)));
    expect(
      useFormattingTemplateStore.getState().templates[0].rules.action.bold,
    ).toBe(true);
  });
  it('keeps geometry, warnings and formatting when a native working copy is reopened', async () => {
    const imported = await parseScreenplayImport('Original.osf', source(), {
      hydrateStores: true,
    });
    const editor = {
      isDestroyed: false,
      getJSON: () => imported.doc,
    } as Editor;
    const saved = JSON.parse(JSON.stringify(buildSaveContent(editor)));
    useEditorStore.setState({
      pageLayout: DEFAULT_PAGE_LAYOUT,
      sourceFidelity: null,
    });
    useFormattingTemplateStore.setState({
      templates: [],
      activeTemplateId: null,
    });
    expect(hydrateEditorStoresFromContent(saved)).toBe(true);
    expect(useEditorStore.getState().pageLayout.pageWidth).toBeCloseTo(
      2100 / 254,
    );
    expect(
      useEditorStore.getState().sourceFidelity?.warnings.join(' '),
    ).toContain('line spacing');
    expect(
      useFormattingTemplateStore.getState().getActiveTemplate().rules.action,
    ).toMatchObject({ marginTop: 18, bold: true });
    const linked = parseOSF(
      serializeContentForFormat('osf', saved, 'Working copy'),
    );
    expect(linked.elementRules?.action?.marginTop).toBe(18);
  });
  it('lays out title-page blocks using the imported page height', () => {
    const shorter = parseOSF(source(2159, 2794));
    const taller = parseOSF(source(2100, 2970));
    const titleCount = (parsed: ReturnType<typeof parseOSF>) =>
      parsed.doc.content?.filter((node) => node.type === 'titlePage').length ??
      0;
    expect(titleCount(taller)).toBeGreaterThan(titleCount(shorter));
  });
  for (const version of [12, 20, 21, 30, 40])
    it(`reads geometry and inherited spacing in OSF ${version}`, () => {
      const xml = source()
        .replace('version="40"', `version="${version}"`)
        .replaceAll('leftindent=', 'leftIndent=')
        .replaceAll('spacebefore=', 'spaceBefore=');
      const parsed = parseOSF(xml);
      expect(parsed.pageLayout?.pageWidth).toBeCloseTo(2100 / 254);
      expect(parsed.elementRules?.dialogue?.leftIndent).toBeCloseTo(365 / 254);
      expect(parsed.elementRules?.dialogue?.marginTop).toBe(18);
    });
  it('defaults only missing settings, warns on invalid measurements, and rejects impossible margins', () => {
    expect(
      parseOSF('<document><paragraphs/></document>').pageLayout?.pageWidth,
    ).toBeUndefined();
    expect(
      parseOSF(
        source().replace('page_width="2100"', 'page_width="bad"'),
      ).warnings.join(' '),
    ).toContain('Invalid OSF setting page_width');
    expect(() =>
      parseOSF(source().replace('margin_left="390"', 'margin_left="9999"')),
    ).toThrow('printable page area');
  });
  it('emits a single scene setting when retained settings and current options overlap', () => {
    const p = parseOSF(source());
    const xml = exportOSF(p.doc, {
      pageLayout: { ...DEFAULT_PAGE_LAYOUT, ...p.pageLayout },
      sceneNumbers: { visible: true, locked: false },
    });
    expect(xml.match(/scene_numbering=/g)).toHaveLength(1);
    expect(() => parseOSF(xml)).not.toThrow();
  });
});
