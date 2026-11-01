import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { exportDocx } from './docxExporter';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
const saved = vi.hoisted(() => ({ bytes: null as Uint8Array | null }));
vi.mock('./fileOps', () => ({
  saveFile: (bytes: Uint8Array) => {
    saved.bytes = bytes;
    return Promise.resolve(true);
  },
}));
describe('reviewed formatting exports', () => {
  it('writes explicit font size, colour, alignment and paragraph geometry to Word', async () => {
    await exportDocx(
      {
        type: 'doc',
        content: [
          {
            type: 'action',
            attrs: {
              textAlign: 'center',
              paragraphLayout: {
                leftIndentPt: 24,
                rightIndentPt: 12,
                spaceBeforePt: 6,
                spaceAfterPt: 12,
                lineSpacing: 1.5,
              },
            },
            content: [
              {
                type: 'text',
                text: 'Reviewed text',
                marks: [
                  {
                    type: 'textStyle',
                    attrs: { fontFamily: 'Arial', fontSize: '18pt', color: '#ff0000' },
                  },
                ],
              },
            ],
          },
        ],
      },
      'Review',
      DEFAULT_PAGE_LAYOUT,
    );
    const xml = await (await JSZip.loadAsync(saved.bytes!))
      .file('word/document.xml')!
      .async('string');
    expect(xml).toContain('w:sz w:val="36"');
    expect(xml).toMatch(/w:color w:val="ff0000"/i);
    expect(xml).toContain('w:jc w:val="center"');
    expect(xml).toContain('w:left="480"');
    expect(xml).toContain('w:right="240"');
    expect(xml).toContain('w:after="240"');
    expect(xml).toContain('w:line="360"');
  });
});
