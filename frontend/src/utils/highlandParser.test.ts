/**
 * Highland (.highland) import: a zipped TextBundle with the script as Fountain.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/react';
import { parseHighland } from './highlandParser';
import { titleNodeOf, bodyTypesOf } from '../test/titlePage';

const SCRIPT = `Title: **BIG FISH**
Credit: Written by
Author: John August

INT. KITCHEN - NIGHT #12A#

Edward stands at the sink.

EDWARD
(quietly)
Hello.

WILL ^
Hi.

CUT TO:
`;

async function highland(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('parseHighland', () => {
  it('reads text.fountain at the root of the bundle', async () => {
    const buf = await highland({
      'text.fountain': SCRIPT,
      'info.json': JSON.stringify({ version: 2, type: 'com.highland.fountain' }),
    });
    const { doc, title, warnings } = await parseHighland(buf);

    expect(title).toBe('BIG FISH');
    expect(titleNodeOf(doc as JSONContent)?.attrs?.tpWrittenBy).toBe('John August');
    expect(bodyTypesOf(doc as JSONContent)).toEqual([
      'sceneHeading', 'action', 'dualDialogue', 'transition',
    ]);
    const heading = (doc.content ?? []).find((n) => n.type === 'sceneHeading');
    expect(heading?.attrs?.sceneNumber).toBe('12A');
    expect(warnings).toEqual([]);
  });

  it('reads a bundle zipped with its .textbundle folder', async () => {
    const buf = await highland({
      'Big Fish.textbundle/info.json': '{}',
      'Big Fish.textbundle/text.fountain': 'EXT. RIVER - DAY\n\nA fish jumps.\n',
      'Big Fish.textbundle/revisions/1/text.fountain': 'INT. OLD - DAY\n',
      '__MACOSX/Big Fish.textbundle/._text.fountain': 'junk',
    });
    const { doc } = await parseHighland(buf);
    expect((doc.content ?? []).map((n) => n.type)).toEqual(['sceneHeading', 'action']);
    expect(doc.content?.[0].content?.[0].text).toBe('EXT. RIVER - DAY');
  });

  it('strips a byte-order mark', async () => {
    const buf = await highland({ 'text.fountain': '\uFEFFINT. LAB - NIGHT\n\nShe waits.\n' });
    const { doc } = await parseHighland(buf);
    expect(doc.content?.[0].type).toBe('sceneHeading');
  });

  it('reads a Markdown Highland document but says so', async () => {
    const buf = await highland({ 'text.markdown': 'Some notes.\n', 'assets/photo.png': 'x' });
    const { warnings } = await parseHighland(buf);
    expect(warnings.join(' ')).toMatch(/text\.markdown rather than Fountain/);
    expect(warnings.join(' ')).toMatch(/Images/);
  });

  it('rejects a file that is not a zip', async () => {
    const buf = new TextEncoder().encode('INT. HOUSE - DAY').buffer;
    await expect(parseHighland(buf)).rejects.toThrow(/not a valid \.highland archive/);
  });

  it('rejects a zip with no script text in it', async () => {
    const buf = await highland({ 'info.json': '{}', 'other.json': '{}' });
    await expect(parseHighland(buf)).rejects.toThrow(/Not a Highland screenplay.*text\.fountain.*found: info\.json/);
  });
});
