/**
 * Real `doc → .docx → doc` round trip, through the actual exporter and importer.
 *
 * The pre-existing harness in `test-script/test-docx-roundtrip.mjs` mirrors the
 * exporter's constants by hand, so it cannot catch a change in the exporter
 * itself. This drives the real modules.
 *
 * The specific regression it pins: OpenDraft used to export every paragraph as
 * unnamed body text, leaving the importer nothing to classify by except indent
 * and text shape. General shares its 1.5" indent with Action, Scene Heading and
 * the act markers, so a General block always came back as `action` (#74).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom';
import type { JSONContent } from '@tiptap/react';
import { doc, block } from '../test/screenplaySchema';

// parseDocx reads OOXML with the platform DOMParser; the node environment has none.
(globalThis as unknown as { DOMParser: unknown }).DOMParser = XmldomDOMParser;

/** Captures the bytes `exportDocx` would have written to disk. */
const saved: { buf: Uint8Array | null } = { buf: null };
vi.mock('./fileOps', () => ({
  saveFile: (data: Uint8Array) => {
    saved.buf = data;
    return Promise.resolve();
  },
}));

async function roundTrip(input: JSONContent): Promise<string[]> {
  const { exportDocx } = await import('./docxExporter');
  const { parseDocx } = await import('./docxImporter');
  const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');
  // Reset lives in beforeEach, not here: assigning `saved.buf = null` in this
  // function narrows the property to `null` for the rest of it, and TypeScript
  // does not widen it back across the `await`.
  await exportDocx(input, 'Test', DEFAULT_PAGE_LAYOUT);
  const bytes = saved.buf;
  if (!bytes) throw new Error('exportDocx wrote nothing');
  const copy = bytes.slice();
  const parsed = await parseDocx(
    copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer,
  );
  return (parsed.doc.content ?? []).map((n) => n.type as string);
}

beforeEach(() => {
  saved.buf = null;
});

describe('DOCX round trip preserves element types', () => {
  it('brings General back as General, not Action', async () => {
    const types = await roundTrip(doc(
      block('sceneHeading', 'INT. HOUSE - DAY'),
      block('general', 'ARCHIVE RECORD 12'),
    ));
    expect(types).toContain('general');
  });

  it('keeps a screenplay sequence intact', async () => {
    const types = await roundTrip(doc(
      block('sceneHeading', 'INT. HOUSE - DAY'),
      block('action', 'A car pulls up.'),
      block('character', 'JOHN'),
      block('dialogue', 'Hello.'),
    ));
    expect(types).toEqual(['sceneHeading', 'action', 'character', 'dialogue']);
  });

  it('distinguishes General from Action at the same indent', async () => {
    // Both sit at 1.5", so only the style name can tell them apart.
    const types = await roundTrip(doc(
      block('action', 'A car pulls up.'),
      block('general', 'Some unformatted text.'),
    ));
    expect(types).toEqual(['action', 'general']);
  });
});
