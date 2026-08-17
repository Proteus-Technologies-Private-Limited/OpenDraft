# FDX browser harness

Runs the real `fdxParser` in a real browser DOM, so the FDX path can be tested
end to end.

## Why this exists

`parseFDXFull` is built on `querySelector`. `@xmldom/xmldom` implements the DOM
Core interfaces but not the Selectors API, so the function throws
`xmlDoc.querySelector is not a function` under vitest's `node` environment — see
`fdx-font-roundtrip.mjs` and `src/utils/fdxFonts.test.ts`, which record the same
constraint. The established answer has been to stage FDX round trips in a
browser; this is that, automated.

The alternative would be adding jsdom or linkedom as a devDependency. That may
still be the right call one day, but it is a bigger decision than a test
harness, and this needs nothing that is not already installed (esbuild comes
with Vite).

## Running it

```bash
./run.sh              # bundle + serve on http://localhost:8791/
./run.sh bundle       # bundle only
PORT=9000 ./run.sh    # different port
```

Then open `http://localhost:8791/` and drive it from the console, or from
Claude's `javascript_tool`. The Chrome extension refuses `file://` URLs, which
is why this is served over http rather than opened directly.

Re-run `./run.sh bundle` after changing any source it pulls in — the bundle is
a snapshot, not a live view.

## What the page gives you

`window.fdx` — every export of `fdxParser` and `fdxExporter`, plus
`DEFAULT_PAGE_LAYOUT`. Namespace imports, so newly exported helpers appear here
without editing `harness-entry.ts`.

`window.h` — helpers:

| | |
|---|---|
| `h.load(name)` | fixture text from `fixtures/<name>` |
| `h.parse(name)` | load and run the real `parseFDXFull` |
| `h.roundTrip(name, title)` | `doc → .fdx → doc`; returns `{first, xml, second, layout}` |
| `h.save(name, data)` | POST to `out/<name>` so a node test can replay it |
| `h.summarize(parsed)` | compact view: node counts, title fields, body lines |

## Getting results into a node test

The half that needs a browser is the parse. Everything downstream — the PDF and
DOCX exporters, `pdftotext` — runs fine in node. So: parse in the browser, POST
the document to `out/`, and replay it in a vitest file.

```js
const rt = await window.h.roundTrip('titlepage.fdx', 'THE LONG GOODBYE');
await window.h.save('parsed-doc.json', { doc: rt.first.doc, pageLayout: rt.first.pageLayout });
```

`example.test.ts` is a worked instance: it replays `out/parsed-doc.json` through
the real PDF exporter and reads the result back with `pdftotext`.

```bash
cd test-script/fdx-browser-harness && npx vitest run
```

It has its own `vitest.config.ts`, because `test-script/vitest.config.ts` only
scans that directory's top level — and keeping it separate keeps these tests out
of the default `npx vitest run` in `test-script/`, which has no browser step.
The suite skips itself when `out/parsed-doc.json` is absent, so it is safe to
run anywhere.

The only seam is the JSON hand-off, which is data rather than behaviour.

## The one gotcha

`run.sh` passes `--define:import.meta.env=...` to esbuild. Do not drop it.
`config.ts` reads `import.meta.env` at module scope, and esbuild's `iife` output
leaves `import.meta` empty — so without the define the bundle throws while
evaluating and `window.fdx` never appears, with **nothing in the console**,
because the throw happens during the script's own evaluation rather than in a
handler. It looks exactly like the bundle failed to load.

## Findings to date

Against `fixtures/titlepage.fdx` (declares Letter; six title-page lines), on
v0.24.0:

- Import produces a 50-node laid-out title-page run, not one collapsed
  attrs-only node.
- The title lands at index 14 — line 15 of Letter's 54. A4 (58 lines) would put
  it at 16, so this pins that the importer used the layout the *file* declares
  rather than whatever the editor had open.
- Exported PDF: title page alone on page 1, script from page 2, all five fields
  present, first script page unnumbered.
- `THE LONG GOODBYE` appears inside `<TitlePage>` and zero times after
  `</TitlePage>` — the old duplication into `<Content>` is gone.
- Round trip is stable. The document is byte-identical across three passes.
  `pageLayout` differs between pass 1 and pass 2 and then converges: the
  hand-written fixture declares no `<HeaderAndFooter>`, so the first export
  supplies the defaults (`{page}.` right-aligned, header from page 2, footer
  from page 1) and every later pass reads back exactly what it wrote. That is
  enrichment, not drift — worth knowing before reading a pass-1-vs-pass-2 diff
  as a bug.

## Not committed by default

`harness.js` and `out/` are build products. If this is kept, they want a
`.gitignore`.
