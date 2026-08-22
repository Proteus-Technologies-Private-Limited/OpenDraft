/**
 * Reads real font files with the app's own parser.
 *
 * The unit tests build synthetic sfnt containers, which proves the reader
 * follows the spec but not that it survives a font shipped by an OS. This runs
 * it over whatever fonts are actually installed, and prints what each file
 * calls itself — so a family name that would end up in a document can be
 * compared against what the OS font panel shows.
 *
 * Usage: node check-font-names.mjs [file-or-directory ...]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../frontend/src/utils/fontFile.ts');

const bundled = await build({
  entryPoints: [src],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'neutral',
});
const module = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const { readFontFileInfo, FontFileError } = module;

const targets = process.argv.slice(2);
if (targets.length === 0) targets.push('/System/Library/Fonts/Supplemental');

const files = [];
for (const target of targets) {
  if (statSync(target).isDirectory()) {
    for (const name of readdirSync(target)) {
      if (/\.(ttf|otf|ttc)$/i.test(name)) files.push(join(target, name));
    }
  } else {
    files.push(target);
  }
}

let ok = 0;
let guessed = 0;
let failed = 0;
for (const file of files.sort()) {
  const bytes = readFileSync(file);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  try {
    const info = readFontFileInfo(buffer, basename(file));
    const source = info.fromFile ? 'file ' : 'GUESS';
    if (info.fromFile) ok++; else guessed++;
    console.log(
      `${source}  ${info.family.padEnd(30)} ${String(info.weight).padEnd(4)}`
      + `${info.italic ? 'italic' : '      '}  ${info.subfamily.padEnd(18)} ← ${basename(file)}`,
    );
  } catch (err) {
    failed++;
    const kind = err instanceof FontFileError ? 'refused' : 'ERROR  ';
    console.log(`${kind}  ${err.message}  ← ${basename(file)}`);
  }
}
console.log(`\n${files.length} files: ${ok} named from the file, ${guessed} guessed from the filename, ${failed} refused.`);
