import { describe, it, expect, beforeAll } from 'vitest';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import {
  extensionOf,
  isBinaryImportExtension,
  isImportableExtension,
  importFormatLabel,
  parseScreenplayImport,
  SCREENPLAY_IMPORT_ACCEPT,
  SCREENPLAY_IMPORT_EXTENSIONS,
} from './importScreenplay';
import { useEditorStore } from '../stores/editorStore';

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
    expect(isBinaryImportExtension('fdx')).toBe(false);
    expect(isBinaryImportExtension(null)).toBe(false);
  });

  it('accepts every listed extension and rejects others', () => {
    for (const ext of SCREENPLAY_IMPORT_EXTENSIONS) {
      expect(isImportableExtension(ext)).toBe(true);
    }
    expect(isImportableExtension('pdf')).toBe(false);
    expect(isImportableExtension(undefined)).toBe(false);
  });

  it('names each format', () => {
    expect(importFormatLabel('fadein')).toBe('Fade In (.fadein)');
    expect(importFormatLabel('osf')).toBe('Open Screenplay Format (.osf)');
    expect(importFormatLabel('rtf')).toBe('.rtf');
    expect(importFormatLabel(null)).toBe('imported file');
  });

  it('builds an accept string covering every extension', () => {
    expect(SCREENPLAY_IMPORT_ACCEPT.split(',')).toEqual(
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

    expect(typesOf(result.doc)).toEqual(['titlePage', 'sceneHeading', 'action']);
    expect(result.title).toBe('Troubled Sleep');
    expect(result.formatLabel).toBe('Open Screenplay Format (.osf)');
  });

  it('unwraps a .fadein archive', async () => {
    const zip = new JSZip();
    zip.file('document.xml', OSF_XML);
    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    const result = await parseScreenplayImport('Script.fadein', buf);

    expect(typesOf(result.doc)).toEqual(['titlePage', 'sceneHeading', 'action']);
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

  it('explains why a .fadein cannot be read from text content', async () => {
    await expect(parseScreenplayImport('Script.fadein', 'garbled')).rejects.toThrow(
      /compressed archives.*Export the script from Fade In/s,
    );
  });

  it('reports a malformed .odraft with a readable message', async () => {
    await expect(parseScreenplayImport('Script.odraft', 'not json')).rejects.toThrow(/Invalid \.odraft file/);
  });

  it('treats an unknown extension as Fountain text', async () => {
    const result = await parseScreenplayImport('notes.md', 'INT. LAB - NIGHT');

    expect(typesOf(result.doc)).toEqual(['sceneHeading']);
    expect(result.formatLabel).toBe('.md');
  });
});
