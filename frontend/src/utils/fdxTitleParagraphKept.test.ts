/**
 * An edited free-form title-page line keeps the file's own paragraph settings.
 */
import { describe, it, expect } from 'vitest';
import { exportFDX } from './fdxExporter';

const scene = { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. HOUSE - DAY' }] };
const doc = (...lines: Record<string, unknown>[]) => ({ type: 'doc', content: [...lines, scene] }) as Parameters<typeof exportFDX>[0];
const line = (attrs: Record<string, unknown>, text: string) => ({
  type: 'titlePage',
  attrs: { field: 'free', ...attrs },
  content: [{ type: 'text', text }],
});

describe('an edited free-form title-page line', () => {
  const original = '<Paragraph Alignment="Center" FirstIndent="0.00" LeftIndent="1.00" OutlineLevel="1" RightIndent="7.50" Spacing="1" />';

  it('keeps the original paragraph settings and writes the new text', () => {
    const xml = exportFDX(doc(line({ align: 'center', fdxXml: original, fdxSig: 'stale' }, 'XYZ')), 'T');
    expect(xml).toContain('<Paragraph Alignment="Center" FirstIndent="0.00" LeftIndent="1.00" OutlineLevel="1" RightIndent="7.50" Spacing="1">');
    expect(xml).toContain('<Text>XYZ</Text>');
  });

  it('takes the alignment from the page, not from the original', () => {
    const xml = exportFDX(doc(line({ align: 'right', fdxXml: original, fdxSig: 'stale' }, 'XYZ')), 'T');
    expect(xml).toContain('<Paragraph Alignment="Right" FirstIndent="0.00" LeftIndent="1.00"');
    expect(xml).not.toContain('<Paragraph Alignment="Center" FirstIndent="0.00" LeftIndent="1.00"');
  });

  it('gives a new line beside a free-form one just its alignment', () => {
    const xml = exportFDX(doc(
      line({ align: 'center', fdxXml: original, fdxSig: 'stale' }, 'XYZ'),
      line({ align: 'center', fdxXml: '', fdxSig: '' }, 'NEW'),
    ), 'T');
    expect(xml).toContain('<Paragraph Alignment="Center">');
    expect(xml).toContain('<Text>NEW</Text>');
  });
});
