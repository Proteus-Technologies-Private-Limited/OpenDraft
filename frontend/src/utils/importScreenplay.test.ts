import { describe, it, expect, beforeAll } from 'vitest';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import {
  extensionOf,
  isBinaryImportExtension,
  isImportableExtension,
  importFormatLabel,
  parseScreenplayImport,
  importAccept,
  SCREENPLAY_IMPORT_EXTENSIONS,
} from './importScreenplay';
import { useEditorStore } from '../stores/editorStore';
import { titleRegionOf, bodyTypesOf } from '../test/titlePage';

beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    (globalThis as unknown as { DOMParser: unknown }).DOMParser = XmlDOMParser;
  }
});

interface Node {
  type: string;
  content?: Node[];
  text?: string;
}

const typesOf = (doc: unknown) => ((doc as { content: Node[] }).content ?? []).map((n) => n.type);

describe('extension helpers', () => {
  it('reads the extension case-insensitively', () => {
    expect(extensionOf('My Script.FadeIn')).toBe('fadein');
    expect(extensionOf('/path/to/Draft 3.fountain')).toBe('fountain');
    expect(extensionOf('no-extension')).toBe('');
  });

  it('knows which formats are archives', () => {
    expect(isBinaryImportExtension('fadein')).toBe(true);
    expect(isBinaryImportExtension('pdf')).toBe(true);
    expect(isBinaryImportExtension('fdx')).toBe(false);
    expect(isBinaryImportExtension(null)).toBe(false);
  });

  it('accepts every listed extension and rejects others', () => {
    for (const ext of SCREENPLAY_IMPORT_EXTENSIONS) {
      expect(isImportableExtension(ext)).toBe(true);
    }
    expect(isImportableExtension('rtf')).toBe(false);
    expect(isImportableExtension(undefined)).toBe(false);
  });

  it('names each format', () => {
    expect(importFormatLabel('fadein')).toBe('Fade In (.fadein)');
    expect(importFormatLabel('osf')).toBe('Open Screenplay Format (.osf)');
    expect(importFormatLabel('rtf')).toBe('.rtf');
    expect(importFormatLabel(null)).toBe('imported file');
  });

  it('builds an accept string covering every extension', () => {
    expect(importAccept().split(',')).toEqual(
      SCREENPLAY_IMPORT_EXTENSIONS.map((e) => `.${e}`),
    );
  });
});

describe('parseScreenplayImport', () => {
  const OSF_XML = `<?xml version="1.0" encoding="utf-8"?>
<document type="Open Screenplay Format document" version="30">
  <styles>
    <style name="Scene Heading" builtin="1" builtin_index="1" basestylename="Normal Text"/>
    <style name="Action" builtin="1" builtin_index="2" basestylename="Normal Text"/>
  </styles>
  <paragraphs>
    <para><style basestylename="Scene Heading"/><text>EXT. PARK - DAY</text></para>
    <para><style basestylename="Action"/><text>A dog speaks.</text></para>
  </paragraphs>
  <titlepage>
    <para bookmark="Title"><style basestylename="Normal Text"/><text>Troubled Sleep</text></para>
  </titlepage>
</document>`;

  it('dispatches .fountain to the Fountain parser', async () => {
    const result = await parseScreenplayImport('Draft.fountain', 'INT. LAB - NIGHT\n\nShe waits.');

    expect(typesOf(result.doc)).toEqual(['sceneHeading', 'action']);
    expect(result.formatLabel).toBe('Fountain (.fountain)');
    expect(result.title).toBe('');
  });

  it('dispatches .osf to the OSF parser and recovers the title', async () => {
    const result = await parseScreenplayImport('Script.osf', OSF_XML);

    expect(titleRegionOf(result.doc).isReal).toBe(true);
    expect(bodyTypesOf(result.doc)).toEqual(['sceneHeading', 'action']);
    expect(result.title).toBe('Troubled Sleep');
    expect(result.formatLabel).toBe('Open Screenplay Format (.osf)');
  });

  it('unwraps a .fadein archive', async () => {
    const zip = new JSZip();
    zip.file('document.xml', OSF_XML);
    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    const result = await parseScreenplayImport('Script.fadein', buf);

    expect(titleRegionOf(result.doc).isReal).toBe(true);
    expect(bodyTypesOf(result.doc)).toEqual(['sceneHeading', 'action']);
    expect(result.title).toBe('Troubled Sleep');
    expect(result.formatLabel).toBe('Fade In (.fadein)');
  });

  describe('document font', () => {
    /** OSF_XML rewritten in another typeface, as Fade In writes a template. */
    const inFont = (font: string, size = '12') =>
      OSF_XML.replace(
        '<styles>',
        `<styles><style name="Normal Text" builtin="1" builtin_index="0" font="${font}" size="${size}"/>`,
      );

    it('puts the file’s typeface on the page', async () => {
      await parseScreenplayImport('Stage Play.osf', inFont('Times New Roman'));
      expect(useEditorStore.getState().fontFamily).toBe('Times New Roman');
    });

    it('keeps Courier Prime for a file written in any Courier', async () => {
      useEditorStore.getState().setFontFamily('Courier Prime');
      await parseScreenplayImport('Screenplay.osf', inFont('Courier Screenplay'));
      expect(useEditorStore.getState().fontFamily).toBe('Courier Prime');
    });

    it('carries the point size across', async () => {
      await parseScreenplayImport('Manuscript.osf', inFont('Times New Roman', '11'));
      expect(useEditorStore.getState().fontSize).toBe(11);
    });

    it('leaves the open document alone when not hydrating stores', async () => {
      useEditorStore.getState().setFontFamily('Courier Prime');
      await parseScreenplayImport('Stage Play.osf', inFont('Arial'), { hydrateStores: false });
      expect(useEditorStore.getState().fontFamily).toBe('Courier Prime');
    });
  });

  describe('other apps’ archives', () => {
    it('treats .highland, .wdz and .celtx as archives with their own names', () => {
      for (const ext of ['highland', 'wdz', 'celtx']) {
        expect(isImportableExtension(ext)).toBe(true);
        expect(isBinaryImportExtension(ext)).toBe(true);
      }
      expect(importFormatLabel('highland')).toBe('Highland (.highland)');
      expect(importFormatLabel('wdz')).toBe('WriterDuet (.wdz)');
      expect(importFormatLabel('celtx')).toBe('Celtx (.celtx)');
    });

    it('dispatches .highland to the Fountain inside it', async () => {
      const zip = new JSZip();
      zip.file('text.fountain', 'Title: Night Swim\n\nINT. POOL - NIGHT\n\nWater.\n');
      const result = await parseScreenplayImport('Night Swim.highland', await zip.generateAsync({ type: 'arraybuffer' }));
      expect(bodyTypesOf(result.doc)).toEqual(['sceneHeading', 'action']);
      expect(result.title).toBe('Night Swim');
      expect(result.formatLabel).toBe('Highland (.highland)');
    });

    it('dispatches .celtx and locks production scene numbers', async () => {
      const zip = new JSZip();
      zip.file(
        'script-a.html',
        '<html><head><title>T</title></head><body>' +
          '<p class="sceneheading" scenestr="4A">INT. A - DAY<br></p><p class="action">Hi.<br></p></body></html>',
      );
      const result = await parseScreenplayImport('T.celtx', await zip.generateAsync({ type: 'arraybuffer' }));
      expect(bodyTypesOf(result.doc)).toEqual(['sceneHeading', 'action']);
      expect(result.metadata).toMatchObject({ _sceneNumbersVisible: true, _sceneNumbersLocked: true });
      expect(useEditorStore.getState().sceneNumbersLocked).toBe(true);
    });

    it('dispatches .wdz to the WriterDuet reader', async () => {
      const zip = new JSZip();
      zip.file('script.json', JSON.stringify({ data: { a: { type: 'Slugline', text: 'EXT. SEA - DAY' } } }));
      const result = await parseScreenplayImport('Sea.wdz', await zip.generateAsync({ type: 'arraybuffer' }));
      expect(typesOf(result.doc)).toEqual(['sceneHeading']);
      expect(result.formatLabel).toBe('WriterDuet (.wdz)');
    });

    it('names the right app when an archive arrives as text', async () => {
      await expect(parseScreenplayImport('Script.wdz', 'garbled')).rejects.toThrow(/Export the script from WriterDuet/);
      await expect(parseScreenplayImport('Script.celtx', 'garbled')).rejects.toThrow(/Export the script from Celtx/);
    });

    it('leaves the open script’s state alone when the archive is corrupt', async () => {
      const openScene = { id: 'open-2', heading: 'INT. OPEN - DAY' } as never;
      useEditorStore.getState().setScenes([openScene]);
      const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]).buffer;
      for (const name of ['Broken.highland', 'Broken.wdz', 'Broken.celtx']) {
        await expect(parseScreenplayImport(name, bytes)).rejects.toThrow(/not a valid/);
      }
      expect(useEditorStore.getState().scenes).toEqual([openScene]);
    });
  });

  it('explains why a .fadein cannot be read from text content', async () => {
    await expect(parseScreenplayImport('Script.fadein', 'garbled')).rejects.toThrow(
      /compressed archives.*Export the script from Fade In/s,
    );
  });

  it('reports a malformed .odraft with a readable message', async () => {
    await expect(parseScreenplayImport('Script.odraft', 'not json')).rejects.toThrow(/Invalid \.odraft file/);
  });

  it('rejects a truncated .fdx instead of importing a blank script', async () => {
    // xmldom throws on its own here; a browser's DOMParser returns <parsererror>,
    // which the parser turns into "Not a valid Final Draft file".
    await expect(
      parseScreenplayImport('Broken.fdx', '<?xml version="1.0"?><FinalDraft><Content><Paragraph'),
    ).rejects.toThrow();
  });

  it('rejects XML that is not a Final Draft document', async () => {
    await expect(
      parseScreenplayImport('Other.fdx', '<?xml version="1.0"?><document><paragraphs/></document>'),
    ).rejects.toThrow(/missing <FinalDraft> root/);
  });

  describe('a file that fails to parse', () => {
    const openScene = { id: 'open-1', heading: 'INT. OPEN SCRIPT - DAY' } as never;

    it.each([
      ['Broken.fdx', '<FinalDraft><Content><Paragraph'],
      ['Broken.osf', '<document><paragraphs'],
      ['Broken.odraft', 'not json'],
    ])('leaves the open script’s state alone (%s)', async (name, data) => {
      useEditorStore.getState().setScenes([openScene]);

      await expect(parseScreenplayImport(name, data)).rejects.toThrow();

      expect(useEditorStore.getState().scenes).toEqual([openScene]);
    });

    it('leaves it alone for a corrupt .fadein archive too', async () => {
      useEditorStore.getState().setScenes([openScene]);
      const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5]).buffer;

      await expect(parseScreenplayImport('Broken.fadein', bytes)).rejects.toThrow();

      expect(useEditorStore.getState().scenes).toEqual([openScene]);
    });

    it('leaves it alone for an unreadable .pdf', async () => {
      useEditorStore.getState().setScenes([openScene]);
      const bytes = new TextEncoder().encode('%PDF-1.4 not really a pdf').buffer;

      await expect(parseScreenplayImport('Broken.pdf', bytes)).rejects.toThrow();

      expect(useEditorStore.getState().scenes).toEqual([openScene]);
    });

    it('still clears it when the file parses', async () => {
      useEditorStore.getState().setScenes([openScene]);

      await parseScreenplayImport('Good.fountain', 'INT. LAB - NIGHT');

      expect(useEditorStore.getState().scenes).toEqual([]);
    });
  });

  it('treats an unknown extension as Fountain text', async () => {
    const result = await parseScreenplayImport('notes.md', 'INT. LAB - NIGHT');

    expect(typesOf(result.doc)).toEqual(['sceneHeading']);
    expect(result.formatLabel).toBe('.md');
  });
});
