/**
 * Checks the PDF -> Final Draft path the "convert a PDF screenplay to Final
 * Draft" blog post describes: the sample PDF is read by OpenDraft's PDF
 * importer, written out by its FDX exporter, and the elements are compared.
 *
 * Run from frontend/:
 *   npx vitest run --root "$PWD/.." --dir "$PWD/../test-script" check_pdf_to_fdx
 * Output: test-script/output/blog-top3/The First Read (from PDF).fdx
 */
// The frontend suite's localStorage shim: the exporter's stores read it at import.
import '../frontend/src/test/setup';
import { test, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePdfScreenplay } from '../frontend/src/utils/pdfImport';
import { exportFDX } from '../frontend/src/utils/fdxExporter';

const OUT = join(__dirname, 'output/blog-top3');

test('PDF imports and exports to FDX with every element intact', async () => {
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(OUT, 'The First Read.pdf'));
  } catch (err) {
    throw new Error(`Sample PDF missing in ${OUT}: ${(err as Error).message}`);
  }
  const parsed = await parsePdfScreenplay(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const types = (parsed.doc.content ?? []).map((n) => n.type);
  console.log('title:', parsed.title, '| warnings:', parsed.warnings);
  console.log('elements:', JSON.stringify(types.reduce<Record<string, number>>((m, t) => ({ ...m, [t as string]: (m[t as string] ?? 0) + 1 }), {})));

  const fdx = exportFDX(parsed.doc as never, parsed.title || 'The First Read');
  const fdxTypes = [...fdx.matchAll(/<Paragraph Type="([^"]+)"/g)].map((m) => m[1]);
  const count = (t: string) => fdxTypes.filter((x) => x === t).length;
  console.log('fdx paragraphs:', JSON.stringify({ sceneHeading: count('Scene Heading'), action: count('Action'), character: count('Character'), dialogue: count('Dialogue'), parenthetical: count('Parenthetical') }));
  writeFileSync(join(OUT, 'The First Read (from PDF).fdx'), fdx, 'utf8');

  expect(count('Scene Heading')).toBe(1);
  expect(count('Character')).toBe(7);
  expect(count('Dialogue')).toBe(7);
  expect(count('Parenthetical')).toBe(1);
  expect(count('Action')).toBe(2);
  expect(fdx).toContain('Twenty seconds of me reading out loud.');
});
