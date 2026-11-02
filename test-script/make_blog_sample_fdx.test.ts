/**
 * Builds the sample Final Draft file used in the "convert Final Draft to PDF or
 * Word" blog post, from the original demo scene "The First Read".
 *
 * Run from frontend/:
 *   npx vitest run --root "$PWD/.." --dir "$PWD/../test-script" make_blog_sample_fdx
 * Output: test-script/output/blog-convert-fdx/The First Read.fdx
 */
// The frontend suite's localStorage shim: the exporter's stores read it at import.
import '../frontend/src/test/setup';
import { test, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFountain } from '../frontend/src/utils/fountainParser';
import { exportFDX } from '../frontend/src/utils/fdxExporter';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'test-script/output/blog-voicestudio/Table Read Demo.fountain');
const OUT_DIR = join(ROOT, 'test-script/output/blog-convert-fdx');

test('writes the sample FDX', () => {
  let text: string;
  try {
    text = readFileSync(SRC, 'utf8');
  } catch (err) {
    throw new Error(`Sample scene not found at ${SRC}: ${(err as Error).message}`);
  }
  const doc = parseFountain(text);
  const fdx = exportFDX(doc as never, 'The First Read');
  expect(fdx).toContain('<FinalDraft');
  expect(fdx).toContain('INT. SMALL APARTMENT - NIGHT');
  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, 'The First Read.fdx');
  writeFileSync(out, fdx, 'utf8');
  console.log(`wrote ${out} (${fdx.length} bytes)`);
});
