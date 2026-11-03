/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { exportFDX, type FDXExportOptions } from './fdxExporter';
import type { JSONContent } from '@tiptap/react';
vi.stubGlobal('DOMParser', DOMParser);
const source: JSONContent = {
  type: 'doc',
  content: [
    { type: 'action', content: [{ type: 'text', text: 'Before' }] },
    {
      type: 'action',
      attrs: { elementNumber: '12', elementNumberLocked: true },
      content: [{ type: 'text', text: 'Original reference' }],
    },
    { type: 'action', content: [{ type: 'text', text: 'After' }] },
    {
      type: 'shot',
      attrs: { elementNumber: 'S7', elementNumberLocked: true },
      content: [{ type: 'text', text: 'CLOSE ON' }],
    },
    {
      type: 'dialogue',
      attrs: { elementNumber: 'D8', elementNumberLocked: true },
      content: [{ type: 'text', text: 'Spoken words.' }],
    },
  ],
};
const write = (doc: JSONContent, options?: FDXExportOptions) =>
  exportFDX(
    doc,
    'References',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    options,
  );

const paragraphsOf = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const content = Array.from(doc.getElementsByTagName('Content')).find(
    (el) => el.parentNode === doc.documentElement,
  )!;
  return Array.from(content.getElementsByTagName('Paragraph'));
};
describe('sparse FDX paragraph references', () => {
  it('exports stored action, shot and dialogue references without numbering other elements', () => {
    const exported = write(source);
    const paragraphs = paragraphsOf(exported);
    expect(Array.from(paragraphs).map((p) => p.getAttribute('Number') || null)).toEqual([
      null,
      '12',
      null,
      'S7',
      'D8',
    ]);
    expect(exported.match(/Number="12"/g) ?? []).toHaveLength(1);
  });
  it('suppresses displayed numbers only in the export copy when explicitly hidden', () => {
    const doc = structuredClone(source);
    const before = JSON.stringify(doc);
    const hidden = write(doc, { elementNumbersVisible: false });
    const paragraphs = paragraphsOf(hidden);
    expect(paragraphs).toHaveLength(5);
    expect(Array.from(paragraphs).every((p) => !p.hasAttribute('Number'))).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('retains legacy non-scene Number values rather than dropping them on export', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'shot',
          attrs: { sceneNumber: 'OLD7' },
          content: [{ type: 'text', text: 'CLOSE ON' }],
        },
      ],
    };
    expect(write(doc)).toMatch(/<Paragraph[^>]*Type="Shot"[^>]*Number="OLD7"/);
  });
});
