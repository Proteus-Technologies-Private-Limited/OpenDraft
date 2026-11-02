// Print the text pdf.js extracts from each page of a PDF.
// Usage: node test-script/pdfjs-extract-text.mjs <file.pdf>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const pdfjs = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(process.argv[2])) }).promise;
for (let i = 1; i <= doc.numPages; i++) {
  const content = await (await doc.getPage(i)).getTextContent();
  console.log(JSON.stringify(content.items.map((item) => item.str)));
}
