/**
 * Celtx (.celtx) import. The fixtures copy the markup classic Celtx writes:
 * HTML 4 with unclosed <br> and <meta>, a <br> closing every paragraph, the
 * title page in the head's <meta>s, and project.rdf naming the script file.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/react';
import { parseCeltx, parseCeltxScriptHtml } from './celtxParser';
import { titleNodeOf, bodyTypesOf } from '../test/titlePage';

const SCRIPT_HTML = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">
<html>
<head>
  <title>THE LONG &amp; WINDING ROAD</title>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta content="left" name="CX.sceneNumbering">
  <meta content="Jane Writer" name="Author">
  <meta content="the novel by Sam Author" name="DC.source">
  <meta content="(c) 2013 Jane Writer" name="DC.rights">
  <meta content="12 Main Street
Springfield" name="CX.contact">
  <meta content="Written by" name="CX.byline">
</head>
<body>
<p scenestr="1" scenenumber="1" id="ytG3Hwl8" class="sceneheading">INT. DINER - NIGHT<br>
</p>
<p class="action">WOMAN is talking to <span class="cast" ref="http://celtx.com/res/x">MAN</span>,
  <b>loudly</b>.<br>
</p>
<p class="action"><br>
</p>
<p class="character">MAN<br>
</p>
<p class="parenthetical">(shaking his head)<br>
</p>
<p class="dialog">Is this seat <i>taken</i>?<br>Or not.<br>
</p>
<div class="softbreak">2.</div>
<p class="transition">CUT TO:<br>
</p>
<div class="hardbreak"> </div>
<p scenestr="2" class="sceneheading">EXT. ROAD - DAY<br>
</p>
<p class="shot">ANGLE ON THE ROAD<br>
</p>
<p class="text">A general line.<br>
</p>
<p class="mystery">Unknown element<br>
</p>
</body>
</html>`;

const PROJECT_RDF = `<?xml version="1.0"?>
<RDF:RDF xmlns:dc="http://purl.org/dc/elements/1.1/"
         xmlns:cx="http://celtx.com/NS/v1/"
         xmlns:RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <cx:Document RDF:about="http://celtx.com/res/az4mQ6dCgfOb"
                   dc:title="Master Catalog">
    <cx:doctype RDF:resource="http://celtx.com/NS/v1/CatalogDocument"/>
  </cx:Document>
  <cx:Document RDF:about="http://celtx.com/res/1kEqvojZWTHA"
                   dc:title="Screenplay"
                   cx:localFile="script-bQ9.html"
                   cx:auxFile="scratch-bQ9.html">
    <cx:doctype RDF:resource="http://celtx.com/NS/v1/ScriptDocument"/>
  </cx:Document>
</RDF:RDF>`;

async function celtx(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return zip.generateAsync({ type: 'arraybuffer' });
}

const bodyOf = (doc: JSONContent) => (doc.content ?? []).filter((n) => n.type !== 'titlePage');

describe('parseCeltxScriptHtml', () => {
  const { doc, title, warnings } = parseCeltxScriptHtml(SCRIPT_HTML);

  it('maps each Celtx element class', () => {
    expect(bodyTypesOf(doc as JSONContent)).toEqual([
      'sceneHeading', 'action', 'character', 'parenthetical', 'dialogue', 'transition',
      'sceneHeading', 'shot', 'general', 'action',
    ]);
    expect(warnings.join(' ')).toMatch(/mystery/);
  });

  it('reads the title page from the head', () => {
    const attrs = titleNodeOf(doc as JSONContent)?.attrs ?? {};
    expect(title).toBe('THE LONG & WINDING ROAD');
    expect(attrs.tpTitle).toBe('THE LONG & WINDING ROAD');
    expect(attrs.tpWrittenBy).toBe('Jane Writer');
    expect(attrs.tpCredit).toBe('Written by');
    expect(attrs.tpBasedOn).toBe('the novel by Sam Author');
    expect(attrs.tpCopyright).toBe('(c) 2013 Jane Writer');
    expect(attrs.tpContact).toBe('12 Main Street\nSpringfield');
  });

  it('collapses whitespace, keeps marks and turns an inner <br> into a hard break', () => {
    const body = bodyOf(doc as JSONContent);
    expect(body[1].content).toEqual([
      { type: 'text', text: 'WOMAN is talking to MAN, ' },
      { type: 'text', text: 'loudly', marks: [{ type: 'bold' }] },
      { type: 'text', text: '.' },
    ]);
    expect(body[4].content).toEqual([
      { type: 'text', text: 'Is this seat ' },
      { type: 'text', text: 'taken', marks: [{ type: 'italic' }] },
      { type: 'text', text: '?' },
      { type: 'hardBreak' },
      { type: 'text', text: 'Or not.' },
    ]);
  });

  it('keeps scene numbers and a hard page break, and drops soft breaks', () => {
    const body = bodyOf(doc as JSONContent);
    expect(body[0].attrs).toEqual({ sceneNumber: '1' });
    expect(body[5].attrs).toBeUndefined();
    expect(body[6].attrs).toEqual({ sceneNumber: '2', startsNewPage: true });
  });

  it('rejects a document with no script in it', () => {
    expect(() => parseCeltxScriptHtml('<html><head><title></title></head><body></body></html>')).toThrow(
      /no screenplay elements/,
    );
    expect(() => parseCeltxScriptHtml('just some text')).toThrow(/no body/);
  });
});

describe('parseCeltx', () => {
  it('opens the script the manifest names', async () => {
    const buf = await celtx({
      'project.rdf': PROJECT_RDF,
      'local.rdf': '<RDF/>',
      'scratch-bQ9.html': '<html><body><p class="action">Scratch</p></body></html>',
      'script-bQ9.html': SCRIPT_HTML,
    });
    const { doc, title, warnings } = await parseCeltx(buf);
    expect(title).toBe('THE LONG & WINDING ROAD');
    expect(bodyOf(doc as JSONContent)[0].content?.[0].text).toBe('INT. DINER - NIGHT');
    expect(warnings.join(' ')).not.toMatch(/scripts/);
  });

  it('falls back to the script-*.html naming without a manifest', async () => {
    const buf = await celtx({ 'script-abc.html': SCRIPT_HTML });
    const { doc } = await parseCeltx(buf);
    expect(bodyOf(doc as JSONContent)).toHaveLength(10);
  });

  it('says when a project holds more than one script', async () => {
    const twoScripts = PROJECT_RDF.replace(
      '</RDF:RDF>',
      `<cx:Document RDF:about="x" dc:title="Sequel" cx:localFile="script-zz.html">
         <cx:doctype RDF:resource="http://celtx.com/NS/v1/ScriptDocument"/>
       </cx:Document></RDF:RDF>`,
    );
    const buf = await celtx({ 'project.rdf': twoScripts, 'script-bQ9.html': SCRIPT_HTML, 'script-zz.html': SCRIPT_HTML });
    const { warnings } = await parseCeltx(buf);
    expect(warnings.join(' ')).toMatch(/holds 2 scripts; only "Screenplay" was imported/);
  });

  it('rejects a file that is not a zip', async () => {
    const buf = new TextEncoder().encode('<html></html>').buffer;
    await expect(parseCeltx(buf)).rejects.toThrow(/not a valid \.celtx archive/);
  });

  it('rejects a project with no script document', async () => {
    const buf = await celtx({ 'project.rdf': '<RDF/>', 'storyboard.html': '<html/>' });
    await expect(parseCeltx(buf)).rejects.toThrow(/Not a Celtx script.*found: project\.rdf/);
  });
});
