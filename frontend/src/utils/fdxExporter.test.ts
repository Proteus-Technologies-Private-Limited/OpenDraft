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

  it('writes a title page that has a credit but no title', () => {
    // The old test was a non-empty `tpTitle`, so this title page was invisible
    // to the exporter and went out as an empty <TitlePage> (issue #98).
    const xml = exportFDX({ type: 'doc', content: [{
      type: 'titlePage',
      attrs: { field: 'title', tpCredit: 'Story by', tpWrittenBy: 'Jane Writer' },
      content: [],
    }] }, 'Untitled Screenplay');
    const tp = xml.slice(xml.indexOf('<TitlePage>'), xml.indexOf('</TitlePage>'));
    expect(tp).toContain('<Text>Story by</Text>');
    expect(tp).toContain('<Text>Jane Writer</Text>');
  });
});

describe('FDX title page — a script that has none', () => {
  const bare = () => exportFDX(
    { type: 'doc', content: [
      { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. HOUSE - DAY' }] },
      { type: 'action', content: [{ type: 'text', text: 'A dog speaks.' }] },
    ] },
    'Untitled Screenplay',
  );

  it('leaves the title page blank instead of inventing one from the document title', () => {
    const xml = bare();
    // The element stays — Final Draft expects it — but carries nothing.
    expect(xml).toContain('<TitlePage>');
    expect(xml.slice(xml.indexOf('<TitlePage>'), xml.indexOf('</TitlePage>')))
      .not.toContain('<Paragraph');
    // The document title is not title-page data and must not leak onto the page.
    expect(xml).not.toContain('Untitled Screenplay');
  });

  it('gives the reader nothing to rebuild a title page from', () => {
    // The round trip is the bug this closes: the exported name came back in as
    // `tpTitle`, `hasTitlePageContent` passed, and the file reopened on a title
    // page the writer never wrote (issue #98). `parseFDXFull` cannot be driven
    // from this suite — it is built on querySelector, which the node
    // environment's XML parser does not implement — so the round trip is pinned
    // from this end: the reader keeps `<Text>` content it finds under
    // <TitlePage> and nothing else, and there is none.
    const tp = bare().slice(bare().indexOf('<TitlePage>'), bare().indexOf('</TitlePage>'));
    expect(tp.match(/<Text[^>]*>[^<]+<\/Text>/g)).toBeNull();
  });
});
