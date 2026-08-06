/**
 * Open Screenplay Format / Fade In import.
 *
 * The XML in these fixtures mirrors what Fade In 3.x and the published OSF
 * 1.2 / 2.0 / 2.1 sample documents actually write, including the casing split:
 * 2.1 uses camelCase attributes, every other revision uses lowercase.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { parseOSF, parseFadeIn } from './osfParser';

// The suite runs without a DOM; the parser needs a DOMParser that produces
// element nodes with children/attributes, which @xmldom/xmldom provides.
beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    (globalThis as unknown as { DOMParser: unknown }).DOMParser = XmlDOMParser;
  }
});

interface Node {
  type: string;
  content?: Node[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
}

/** The <styles> block Fade In writes into every document. */
const BUILTIN_STYLES = `
  <styles>
    <style name="Normal Text" builtin="1" builtin_index="0" label="Normal Text" font="Courier" size="12"/>
    <style name="Scene Heading" builtin="1" builtin_index="1" label="Scene Heading" basestylename="Normal Text" allcaps="1"/>
    <style name="Action" builtin="1" builtin_index="2" label="Action" basestylename="Normal Text"/>
    <style name="Character" builtin="1" builtin_index="3" label="Character" basestylename="Normal Text" allcaps="1"/>
    <style name="Parenthetical" builtin="1" builtin_index="4" label="Parenthetical" basestylename="Normal Text"/>
    <style name="Dialogue" builtin="1" builtin_index="5" label="Dialogue" basestylename="Normal Text"/>
    <style name="Transition" builtin="1" builtin_index="6" label="Transition" basestylename="Normal Text" align="right"/>
    <style name="Shot" builtin="1" builtin_index="7" label="Shot" basestylename="Normal Text" allcaps="1"/>
  </styles>`;

function osfDocument(body: string, opts: { version?: string; extra?: string } = {}): string {
  const { version = '30', extra = '' } = opts;
  return `<?xml version="1.0" encoding="utf-8"?>
<document type="Open Screenplay Format document" version="${version}">
  <info uuid="3C4D9038-A349-4F3F-8A2C-E0AB18220386" pagecount="1"/>
  ${BUILTIN_STYLES}
  ${extra}
  <paragraphs>${body}</paragraphs>
</document>`;
}

function para(style: string, text: string, styleAttrs = '', paraAttrs = ''): string {
  return `<para ${paraAttrs}><style basestylename="${style}" ${styleAttrs}/><text>${text}</text></para>`;
}

/** Concatenated plain text of a node, hard breaks becoming newlines. */
function textOf(node: Node): string {
  return (node.content ?? [])
    .map((child) => (child.type === 'hardBreak' ? '\n' : child.text ?? ''))
    .join('');
}

describe('parseOSF — element mapping', () => {
  it('maps the eight built-in styles to screenplay elements', () => {
    const xml = osfDocument(
      [
        para('Scene Heading', 'EXT. APARTMENT - DAY'),
        para('Action', 'AUTHOR wakes on the stoop.'),
        para('Character', 'AUTHOR'),
        para('Parenthetical', '(to self)'),
        para('Dialogue', 'Sleep walking again.'),
        para('Transition', 'CUT TO:'),
        para('Shot', 'CLOSE ON — THE DOOR'),
        para('Normal Text', 'A stray line.'),
      ].join(''),
    );

    const { doc } = parseOSF(xml);
    const nodes = doc.content as Node[];

    expect(nodes.map((n) => n.type)).toEqual([
      'sceneHeading',
      'action',
      'character',
      'parenthetical',
      'dialogue',
      'transition',
      'shot',
      'general',
    ]);
    expect(textOf(nodes[0])).toBe('EXT. APARTMENT - DAY');
    expect(textOf(nodes[4])).toBe('Sleep walking again.');
  });

  it('resolves a user-defined style through its base style', () => {
    const xml = osfDocument(para('Sound Effect', 'A DOOR SLAMS.'), {
      extra: '',
    }).replace(
      '</styles>',
      '<style name="Sound Effect" label="Sound Effect" basestylename="Action"/></styles>',
    );

    const { doc, warnings } = parseOSF(xml);
    expect((doc.content as Node[])[0].type).toBe('action');
    expect(warnings).toEqual([]);
  });

  it('falls back to Action and warns for a style it cannot resolve', () => {
    const xml = osfDocument(para('Marginalia', 'Who knows.'));
    const { doc, warnings } = parseOSF(xml);

    expect((doc.content as Node[])[0].type).toBe('action');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Marginalia');
  });

  it('reads the style name when basestylename is absent', () => {
    // Fade In writes the document's trailing paragraph this way.
    const xml = osfDocument(
      '<para><style basestylename="Action"/><text>Body.</text></para>' +
        '<para><style name="Scene Heading" label="Scene Heading"/><text>INT. LAB - NIGHT</text></para>',
    );
    const nodes = parseOSF(xml).doc.content as Node[];
    expect(nodes.map((n) => n.type)).toEqual(['action', 'sceneHeading']);
  });
});

describe('parseOSF — formatting', () => {
  it('carries bold, italic, underline and strikethrough onto text runs', () => {
    const xml = osfDocument(
      '<para><style basestylename="Action"/>' +
        '<text bold="1">Bold </text>' +
        '<text italic="1">Italic </text>' +
        '<text underline="1">Under </text>' +
        '<text strikethrough="1">Struck</text>' +
        '</para>',
    );
    const runs = (parseOSF(xml).doc.content as Node[])[0].content as Node[];

    expect(runs.map((r) => r.marks?.map((m) => m.type))).toEqual([
      ['bold'],
      ['italic'],
      ['underline'],
      ['strike'],
    ]);
  });

  it('accepts OSF 2.1 camelCase attributes', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<document type="Open Screenplay Format document" version="21">
  <styles><style name="Action" builtin="1" builtInIndex="2" baseStyleName="Normal Text"/></styles>
  <paragraphs>
    <para><style baseStyleName="Action"/><text strikeThrough="1" bgColor="#00FF00">Struck</text></para>
  </paragraphs>
</document>`;
    const node = (parseOSF(xml).doc.content as Node[])[0];

    expect(node.type).toBe('action');
    const marks = (node.content as Node[])[0].marks ?? [];
    expect(marks.map((m) => m.type).sort()).toEqual(['highlight', 'strike']);
    expect(marks.find((m) => m.type === 'highlight')?.attrs).toEqual({ color: '#00ff00' });
  });

  // OSF 1.2 escapes a pseudo-HTML vocabulary into the run text instead of
  // using attributes.
  describe('OSF 1.2 inline markup', () => {
    function osf12(body: string): string {
      return `<?xml version="1.0" encoding="utf-8" ?>
<document type="Open Screenplay Format document" version="12">
${BUILTIN_STYLES}
<paragraphs>${body}</paragraphs>
</document>`;
    }

    it('turns nested <b>/<i>/<u> tags into marks', () => {
      const xml = osf12(
        '<para><style basestylename="Action"/><text>&lt;b&gt;&lt;i&gt;Bold-italic &lt;u&gt;and underlined&lt;/u&gt;&lt;/i&gt;&lt;/b&gt; plain</text></para>',
      );
      const runs = (parseOSF(xml).doc.content as Node[])[0].content as Node[];

      expect(runs.map((r) => [r.text, (r.marks ?? []).map((m) => m.type)])).toEqual([
        ['Bold-italic ', ['bold', 'italic']],
        ['and underlined', ['bold', 'italic', 'underline']],
        [' plain', []],
      ]);
    });

    it('turns <font>/<size>/<bgcolor> into textStyle and highlight marks', () => {
      const xml = osf12(
        '<para><style basestylename="Action"/><text>&lt;font="Times New Roman"&gt;&lt;size="18"&gt;Big&lt;/size&gt;&lt;/font&gt;' +
          '&lt;bgcolor="#00FF00"&gt;Green&lt;/bgcolor&gt;</text></para>',
      );
      const runs = (parseOSF(xml).doc.content as Node[])[0].content as Node[];

      expect(runs[0].marks).toEqual([
        { type: 'textStyle', attrs: { fontFamily: 'Times New Roman', fontSize: '18pt' } },
      ]);
      expect(runs[1].marks).toEqual([{ type: 'highlight', attrs: { color: '#00ff00' } }]);
    });

    it('turns <br> into a hardBreak', () => {
      const xml = osf12('<para><style basestylename="Action"/><text>One&lt;br&gt;Two</text></para>');
      const runs = (parseOSF(xml).doc.content as Node[])[0].content as Node[];
      expect(runs.map((r) => r.type)).toEqual(['text', 'hardBreak', 'text']);
    });

    it('leaves the same markup alone in a 2.x document', () => {
      const xml = osfDocument(
        '<para><style basestylename="Action"/><text>He typed &lt;b&gt;bold&lt;/b&gt; into the box.</text></para>',
      );
      const runs = (parseOSF(xml).doc.content as Node[])[0].content as Node[];
      expect(runs[0].text).toBe('He typed <b>bold</b> into the box.');
    });
  });

  it('keeps a soft return inside a run as a hardBreak node', () => {
    const xml = osfDocument(
      '<para><style basestylename="Action"/><text>First line\nsecond line</text></para>',
    );
    const runs = (parseOSF(xml).doc.content as Node[])[0].content as Node[];

    expect(runs.map((r) => r.type)).toEqual(['text', 'hardBreak', 'text']);
  });

  it('carries alignment, scene numbers and page breaks', () => {
    const xml = osfDocument(
      para('Action', 'THE END.', 'align="center"') +
        para('Scene Heading', 'INT. LAB - NIGHT', 'pagebreakbefore="1"', 'scene_number="12"'),
    );
    const nodes = parseOSF(xml).doc.content as Node[];

    expect(nodes[0].attrs).toEqual({ textAlign: 'center' });
    expect(nodes[1].attrs).toEqual({ sceneNumber: '12', startsNewPage: true });
  });

  it('applies a non-default font and size as a textStyle mark', () => {
    const xml = osfDocument(
      '<para><style basestylename="Action"/><text font="Times New Roman" size="16">Big</text>' +
        '<text font="Courier" size="12">Plain</text></para>',
    );
    const runs = (parseOSF(xml).doc.content as Node[])[0].content as Node[];

    expect(runs[0].marks?.[0]).toEqual({
      type: 'textStyle',
      attrs: { fontFamily: 'Times New Roman', fontSize: '16pt' },
    });
    expect(runs[1].marks).toBeUndefined();
  });
});

describe('parseOSF — structure', () => {
  // OSF puts dualdialogue="1" on the FIRST speaker of the pair — the opposite
  // of Fountain's `^`, which marks the second.
  it('pairs a dualdialogue character with the speech that follows it', () => {
    const xml = osfDocument(
      para('Character', 'CHORUS') +
        para('Dialogue', 'Before.') +
        para('Character', 'ANNA', 'dualdialogue="1"') +
        para('Parenthetical', '(over him)') +
        para('Dialogue', 'Go.') +
        para('Character', 'BEN') +
        para('Dialogue', 'Now.') +
        para('Action', 'They leave.'),
    );
    const nodes = parseOSF(xml).doc.content as Node[];

    expect(nodes.map((n) => n.type)).toEqual(['character', 'dialogue', 'dualDialogue', 'action']);
    const [left, right] = nodes[2].content as Node[];
    expect((left.content as Node[]).map(textOf)).toEqual(['ANNA', '(over him)', 'Go.']);
    expect((right.content as Node[]).map(textOf)).toEqual(['BEN', 'Now.']);
  });

  it('does not drag an earlier speaker into the pair', () => {
    const xml = osfDocument(
      para('Character', 'CHORUS') +
        para('Dialogue', 'Before.') +
        para('Character', 'ANNA', 'dualdialogue="1"') +
        para('Dialogue', 'Go.') +
        para('Character', 'BEN') +
        para('Dialogue', 'Now.'),
    );
    const nodes = parseOSF(xml).doc.content as Node[];
    const [left] = (nodes[2].content as Node[]);
    expect((left.content as Node[]).map(textOf)).toEqual(['ANNA', 'Go.']);
  });

  it('leaves an unpaired dual-dialogue speaker as ordinary dialogue', () => {
    const xml = osfDocument(
      para('Character', 'BEN', 'dualdialogue="1"') + para('Dialogue', 'Now.') + para('Action', 'Silence.'),
    );
    const nodes = parseOSF(xml).doc.content as Node[];
    expect(nodes.map((n) => n.type)).toEqual(['character', 'dialogue', 'action']);
  });

  it('drops the empty terminating paragraph Fade In appends', () => {
    const xml = osfDocument(
      para('Action', 'Last beat.') + '<para><style name="Normal Text"/><text></text></para>',
    );
    const nodes = parseOSF(xml).doc.content as Node[];

    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('action');
  });

  it('attaches a paragraph note and synopsis to its scene heading', () => {
    const xml = osfDocument(
      para('Scene Heading', 'INT. LAB - NIGHT', '', 'synopsis="The reveal" note="check continuity"'),
    );
    const node = (parseOSF(xml).doc.content as Node[])[0];
    expect(node.attrs?.synopsis).toBe('The reveal\ncheck continuity');
  });

  it('returns a single empty action for a document with no paragraphs', () => {
    const xml = `<?xml version="1.0"?><document type="Open Screenplay Format document" version="30"/>`;
    const { doc, warnings } = parseOSF(xml);

    expect(doc.content).toEqual([{ type: 'action', content: [] }]);
    expect(warnings[0]).toContain('no <paragraphs>');
  });
});

describe('parseOSF — title page', () => {
  it('reads the OSF 1.2 <info> attributes', () => {
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<document type="Open Screenplay Format document" version="12">
<info title="The Long Walk" written_by="A. Writer" copyright="Copyright (c) 2016" contact="a@example.com" drafts="First Draft"/>
${BUILTIN_STYLES}
<paragraphs>${para('Action', 'Body.')}</paragraphs>
</document>`;
    const { doc, scriptTitle } = parseOSF(xml);
    const titlePage = (doc.content as Node[])[0];

    expect(titlePage.type).toBe('titlePage');
    expect(titlePage.attrs).toMatchObject({
      tpTitle: 'The Long Walk',
      tpWrittenBy: 'A. Writer',
      tpCopyright: 'Copyright (c) 2016',
      tpContact: 'a@example.com',
      tpDraft: 'First Draft',
    });
    expect(scriptTitle).toBe('The Long Walk');
  });

  it('reads the OSF 2.x <titlepage> bookmarks', () => {
    const xml = osfDocument(para('Action', 'Body.'), {
      extra: `<titlepage>
        <para><style basestylename="Normal Text"/><text></text></para>
        <para bookmark="Title"><style basestylename="Normal Text" align="center"/><text underline="1">The Long Walk</text></para>
        <para bookmark="Author"><style basestylename="Normal Text" align="center"/><text>A. Writer</text></para>
        <para bookmark="Contact"><style basestylename="Normal Text"/><text>a@example.com</text></para>
      </titlepage>`,
    });
    const { doc, scriptTitle } = parseOSF(xml);
    const titlePage = (doc.content as Node[])[0];

    expect(titlePage.attrs).toMatchObject({
      tpTitle: 'The Long Walk',
      tpWrittenBy: 'A. Writer',
      tpContact: 'a@example.com',
    });
    expect(scriptTitle).toBe('The Long Walk');
    // The body still follows the title page.
    expect((doc.content as Node[])[1].type).toBe('action');
  });

  it('emits no title page when the file carries none', () => {
    const { doc, scriptTitle } = parseOSF(osfDocument(para('Action', 'Body.')));
    expect((doc.content as Node[])[0].type).toBe('action');
    expect(scriptTitle).toBe('');
  });
});

describe('parseOSF — bad input', () => {
  it('rejects XML that is not an OSF document', () => {
    expect(() => parseOSF('<FinalDraft><Content/></FinalDraft>')).toThrow(/missing <document> root/);
  });
});

describe('parseFadeIn', () => {
  async function fadeInArchive(entryName: string, xml: string): Promise<ArrayBuffer> {
    const zip = new JSZip();
    zip.file(entryName, xml);
    return zip.generateAsync({ type: 'arraybuffer' });
  }

  it('unwraps document.xml from the archive and parses it', async () => {
    const buf = await fadeInArchive(
      'document.xml',
      osfDocument(para('Scene Heading', 'EXT. PARK - DAY') + para('Action', 'A dog speaks.')),
    );
    const { doc } = await parseFadeIn(buf);

    expect((doc.content as Node[]).map((n) => n.type)).toEqual(['sceneHeading', 'action']);
  });

  it('reports a clear error when the file is not a ZIP archive', async () => {
    const notAZip = new TextEncoder().encode('INT. NOT A ZIP - DAY').buffer;
    await expect(parseFadeIn(notAZip)).rejects.toThrow(/not a valid \.fadein archive/);
  });

  it('reports a clear error when the archive has no document.xml', async () => {
    const buf = await fadeInArchive('other.xml', '<document/>');
    await expect(parseFadeIn(buf)).rejects.toThrow(/no document\.xml/);
  });
});
