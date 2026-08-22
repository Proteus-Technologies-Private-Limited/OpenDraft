/**
 * Header/footer settings surviving a full `.fdx` round trip.
 *
 * `frontend/src/utils/fdxHeaderFooter.test.ts` covers the mapping by calling
 * `parseHeaderAndFooter` directly, because the rest of `parseFDXFull` is built
 * on `querySelector` and cannot run under vitest's node environment. What it
 * cannot show is that `parseFDXFull` actually *wires that result into*
 * `pageLayout` — which is the half a user's imported file depends on.
 *
 * This closes that gap: the layouts below were produced by the real
 * `parseFDXFull` running in a real browser DOM (see README) and posted back to
 * `out/hf-roundtrip.json`.
 *
 * Regenerate by serving the harness and running the snippet in README's
 * "Getting results into a node test", substituting:
 *
 *   const custom = { ...window.fdx.DEFAULT_PAGE_LAYOUT,
 *     headerContent: { left: 'BLUE DRAFT', center: '{title}', right: '{page} of {pages}' },
 *     footerContent: { left: '', center: 'CONFIDENTIAL', right: '' },
 *     headerStartPage: 4, footerStartPage: 3, startingPageNumber: 3 };
 *
 * Skips itself when that file is absent, so it cannot fail a run with no
 * browser step.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = join(HERE, 'out', 'hf-roundtrip.json');

interface HeaderFooterContent { left: string; center: string; right: string }
interface Layout {
  headerContent?: HeaderFooterContent;
  footerContent?: HeaderFooterContent;
  headerStartPage?: number;
  footerStartPage?: number;
  startingPageNumber?: number;
}
interface Capture {
  sent: Layout;
  pass1Layout: Layout | null;
  pass2Layout: Layout | null;
  pass3Layout: Layout | null;
  xml2HfBlock: string;
  xmlIdentical: boolean;
}

const available = existsSync(CAPTURE);
const cap: Capture = available
  ? (JSON.parse(readFileSync(CAPTURE, 'utf8')) as Capture)
  : ({} as Capture);

/** Only the fields this feature owns — the rest of the layout is page geometry. */
const hf = (l: Layout | null | undefined) => ({
  headerContent: l?.headerContent,
  footerContent: l?.footerContent,
  headerStartPage: l?.headerStartPage,
  footerStartPage: l?.footerStartPage,
  startingPageNumber: l?.startingPageNumber,
});

describe.skipIf(!available)('header/footer through the real parseFDXFull', () => {
  it('leaves the layout alone when the file declares no <HeaderAndFooter>', () => {
    // The fixture is hand-written and has no such block. A parser that wrote
    // defaults in anyway would silently blank a header the file never mentioned.
    expect(cap.pass1Layout?.headerContent).toBeUndefined();
    expect(cap.pass1Layout?.startingPageNumber).toBeUndefined();
  });

  it('carries every slot back, fields and all', () => {
    expect(cap.pass2Layout?.headerContent).toEqual(cap.sent.headerContent);
    expect(cap.pass2Layout?.footerContent).toEqual(cap.sent.footerContent);
  });

  it('carries the starting page number back', () => {
    expect(cap.pass2Layout?.startingPageNumber).toBe(cap.sent.startingPageNumber);
  });

  it('decides each band independently across the round trip', () => {
    // The asymmetric case: the header skips the first script page while the
    // footer appears on it. A single shared first-page flag collapses these.
    expect(cap.pass2Layout?.headerStartPage).toBe(cap.sent.headerStartPage);
    expect(cap.pass2Layout?.footerStartPage).toBe(cap.sent.footerStartPage);
  });

  it('writes Final Draft attributes matching that asymmetry', () => {
    expect(cap.xml2HfBlock).toContain('HeaderFirstPage="No"');
    expect(cap.xml2HfBlock).toContain('FooterFirstPage="Yes"');
    // The old exporter hardcoded FooterVisible="No" and emitted no <Footer>.
    expect(cap.xml2HfBlock).toContain('FooterVisible="Yes"');
    expect(cap.xml2HfBlock).toContain('<Footer>');
    expect(cap.xml2HfBlock).toContain('StartingPage="3"');
  });

  it('is stable, not merely lossless', () => {
    // Compare pass 2 to pass 3, never pass 1 to pass 2: the first export
    // ENRICHES a fixture that carried no header/footer block, so a 1-vs-2 diff
    // reports that enrichment and looks like drift. Convergence is the property
    // that matters.
    expect(hf(cap.pass3Layout)).toEqual(hf(cap.pass2Layout));
    expect(cap.xmlIdentical, 'a second export must be byte-identical').toBe(true);
  });
});
