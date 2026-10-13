import { describe, it, expect, vi } from 'vitest';
import type { JSONContent } from '@tiptap/react';

vi.mock('./elementColors', () => ({
  getElementColors: () => ({ sceneHeading: { text: '#ff2600', background: '#ffff00' } }),
}));

const { exportOSF } = await import('./osfExporter');

const heading = (marks?: JSONContent['marks']): JSONContent => ({
  type: 'sceneHeading',
  content: [{ type: 'text', text: 'INT. ROOM - DAY', ...(marks ? { marks } : {}) }],
});
const docOf = (...nodes: JSONContent[]): JSONContent => ({ type: 'doc', content: nodes });
const textTags = (xml: string) => xml.match(/<text[^>]*>/g) ?? [];

describe('Fade In element colours', () => {
  it('writes the element text colour and background on each run', () => {
    const xml = exportOSF(docOf(heading()), { elementColors: true });
    expect(xml).toContain('<text color="FF2600" bgcolor="FFFF00">INT. ROOM - DAY</text>');
  });

  it('writes no colour unless asked (plain black on white)', () => {
    const xml = exportOSF(docOf(heading()));
    expect(textTags(xml).some((t) => /color=/.test(t))).toBe(false);
  });

  it('lets a colour the writer applied by hand win over the element colour', () => {
    const xml = exportOSF(
      docOf(heading([{ type: 'textStyle', attrs: { color: '#00ff00' } }])),
      { elementColors: true },
    );
    expect(xml).toContain(' color="00FF00"');
    expect(xml).not.toContain(' color="FF2600"');
    expect(xml).toContain(' bgcolor="FFFF00"');
  });

  it('black and white drops element colours and hand-applied colours alike', () => {
    const xml = exportOSF(
      docOf(heading([
        { type: 'textStyle', attrs: { color: '#00ff00' } },
        { type: 'highlight', attrs: { color: '#ffff00' } },
      ])),
      { elementColors: true, blackAndWhite: true },
    );
    expect(textTags(xml).some((t) => /color=/.test(t))).toBe(false);
  });
});
