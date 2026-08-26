import { describe, it, expect } from 'vitest';
import { exportFDX } from './fdxExporter';
import { doc, block, BR } from '../test/screenplaySchema';

const fdx = (d: Parameters<typeof exportFDX>[0]) => exportFDX(d);

describe('FDX export with hard breaks', () => {
  it('emits the break as an encoded newline in its own Text run', () => {
    const out = fdx(doc(block('action', 'One', BR, 'Two')));
    expect(out).toContain('<Text>One</Text>');
    expect(out).toContain('<Text>&#10;</Text>');
    expect(out).toContain('<Text>Two</Text>');
  });

  it('never emits a raw newline inside a Text element', () => {
    // A raw newline would be collapsed to a space by whitespace-normalizing
    // XML readers, silently losing the break.
    const out = fdx(doc(block('action', 'One', BR, 'Two')));
    const texts = out.match(/<Text[^>]*>[^<]*<\/Text>/g) || [];
    for (const t of texts) expect(t).not.toMatch(/\n/);
  });

  it('encodes a stray newline arriving through esc()', () => {
    const out = fdx(doc({ type: 'action', content: [{ type: 'text', text: 'a\nb' }] }));
    expect(out).toContain('a&#10;b');
  });

  it('does not break a Character paragraph into a phantom speaker', () => {
    const out = fdx(doc(block('character', 'JOHN', BR, 'SMITH')));
    const charPara = out.split('\n').filter((l) => l.includes('Type="Character"')).join('\n');
    expect(charPara).not.toContain('&#10;');
  });

  it('produces well-formed XML', () => {
    const out = fdx(doc(
      block('sceneHeading', 'INT. HOUSE - DAY'),
      block('action', 'A', BR, 'B'),
      block('character', 'JOHN'),
      block('dialogue', 'Hi', BR, 'there.'),
    ));
    // Tags balance, and the ampersand in &#10; is the only bare & form used.
    const opens = (out.match(/<Paragraph[ >]/g) || []).length;
    const closes = (out.match(/<\/Paragraph>/g) || []).length
      + (out.match(/<Paragraph [^>]*\/>/g) || []).length
      + (out.match(/<Paragraph [^>]*><Text><\/Text><\/Paragraph>/g) || []).length;
    expect(closes).toBeGreaterThanOrEqual(opens - closes);
    expect(out).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#10;)/);
  });

  it('preserves a break inside an AV cell', () => {
    const out = fdx(doc({
      type: 'avBlock',
      content: [{
        type: 'avRow',
        content: [{
          type: 'avCell',
          attrs: { side: 'video' },
          content: [block('avPara', 'Wide', BR, 'shot')],
        }],
      }],
    }));
    expect(out).toContain('Wide&#10;shot');
  });
});

describe('FDX title page — fields the exporter used to drop', () => {
  const titlePageOf = (attrs: Record<string, string>): string => {
    const xml = exportFDX(
      { type: 'doc', content: [{
        type: 'titlePage',
        attrs: { field: 'title', tpTitle: 'THE LONG GOODBYE', ...attrs },
        content: [{ type: 'text', text: 'THE LONG GOODBYE' }],
      }] },
      'THE LONG GOODBYE',
    );
    return xml.slice(xml.indexOf('<TitlePage>'), xml.indexOf('</TitlePage>'));
  };

  it('writes the credit the writer chose, not a fixed "Written by"', () => {
    const tp = titlePageOf({ tpCredit: 'Screenplay by', tpWrittenBy: 'Jane Writer' });
    expect(tp).toContain('<Text>Screenplay by</Text>');
    expect(tp).not.toContain('<Text>Written by</Text>');
  });

  it('still writes "Written by" when no credit was chosen', () => {
    expect(titlePageOf({ tpWrittenBy: 'Jane Writer' })).toContain('<Text>Written by</Text>');
  });

  it('writes the WGA registration and the notes', () => {
    const tp = titlePageOf({ tpWgaRegistration: 'WGA #1234', tpNotes: 'Third revision' });
    expect(tp).toContain('<Text>WGA #1234</Text>');
    expect(tp).toContain('<Text>Third revision</Text>');
  });
});
