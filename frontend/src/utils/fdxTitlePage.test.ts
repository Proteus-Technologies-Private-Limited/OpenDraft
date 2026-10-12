/**
 * What the exporter writes for a Final Draft file's free-form title page, and
 * for the run attributes the parser keeps.
 *
 * The parser needs a browser DOM (querySelector) and this suite runs on node,
 * so these tests build the nodes the parser produces and check what comes out.
 * Reading a real file in is checked by comparing a saved copy of a real script
 * against the original, which is how the title page was shown to match line
 * for line.
 */
import { describe, it, expect } from 'vitest';
import { exportFDX } from './fdxExporter';
import { titleLineSignature } from './fdxPreserve';

type Doc = Parameters<typeof exportFDX>[0];

const raw = (text: string, textAttrs = '') =>
  `<Paragraph Alignment="Center" LeftIndent="1.00" OutlineLevel="1"><Text${textAttrs}>${text}</Text></Paragraph>`;
const SHOW = raw('Show NAME', ' Style="Underline+AllCaps"');
const BEFORE = '<HeaderAndFooter FooterVisible="No" HeaderVisible="No" StartingPage="1"/>';
const AFTER = '<TextState Alignment="Center" Spacing="1"/>';

interface LineOptions {
  field?: string;
  xml?: string;
  extras?: Record<string, unknown>;
  marks?: { type: string }[];
}

/** A title page line as the parser makes it: its text, and the original paragraph. */
const titleLine = (text: string, opts: LineOptions = {}) => {
  const content = text ? [{ type: 'text', text, ...(opts.marks ? { marks: opts.marks } : {}) }] : [];
  return {
    type: 'titlePage',
    attrs: {
      field: opts.field ?? 'free',
      align: 'center',
      fdxXml: opts.xml ?? '',
      fdxSig: titleLineSignature('center', content),
      ...(opts.extras ?? {}),
    },
    content,
  };
};

const scene = { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. HOUSE - DAY' }] };
const docOf = (...content: unknown[]) => ({ type: 'doc', content }) as Doc;

const firstLine = titleLine('', { field: 'blank', xml: raw(''), extras: { fdxTitleBefore: BEFORE, fdxTitleAfter: AFTER } });
const showLine = titleLine('Show NAME', { field: 'title', xml: SHOW, marks: [{ type: 'underline' }] });
const writtenLine = titleLine('Written by', { xml: raw('Written by') });
const aliceLine = titleLine('Alice Real', { xml: raw('Alice Real') });

describe('a free-form Final Draft title page, on export', () => {
  it('writes lines left alone back exactly as the file had them', () => {
    const out = exportFDX(docOf(firstLine, showLine, writtenLine, aliceLine, scene));
    expect(out).toContain(SHOW);
    expect(out).toContain(raw('Written by'));
    expect(out).toContain(raw('Alice Real'));
  });

  it('keeps the title page header, footer and text state around its lines', () => {
    const out = exportFDX(docOf(firstLine, showLine, scene));
    expect(out).toMatch(/<HeaderAndFooter FooterVisible="No"[^>]*\/>\s*<Content>/);
    expect(out).toMatch(/<TextState Alignment="Center"[^>]*\/>\s*<\/TitlePage>/);
  });

  it('writes an edited line from what is on screen and leaves the others alone', () => {
    const edited = titleLine('Alice Smith', { xml: raw('Alice Real') });
    // The signature is the one taken when the file was opened, before the edit.
    edited.attrs.fdxSig = titleLineSignature('center', [{ type: 'text', text: 'Alice Real' }]);
    const out = exportFDX(docOf(firstLine, showLine, writtenLine, edited, scene));
    expect(out).toContain('>Alice Smith</Text>');
    expect(out).not.toContain('Alice Real');
    expect(out).toContain(SHOW);
    expect(out).toContain(raw('Written by'));
  });

  it('still writes a title page made in WriTea Draft from its form fields', () => {
    const made = { type: 'titlePage', attrs: { field: 'title', tpTitle: 'My Film' }, content: [{ type: 'text', text: 'My Film' }] };
    const out = exportFDX(docOf(made, scene));
    expect(out).toContain('>My Film</Text>');
  });
});

describe('text run attributes, on export', () => {
  const para = {
    type: 'action',
    content: [
      { type: 'text', text: 'Black', marks: [{ type: 'fdxAdornment', attrs: { style: '', black: true } }] },
      { type: 'text', text: 'Plain' },
      { type: 'text', text: 'Tagged', marks: [{ type: 'fdxAdornment', attrs: { style: '-1', black: false } }] },
    ],
  };

  it('writes a Color only on a run that had one, and keeps an explicit black', () => {
    const out = exportFDX(docOf(scene, para));
    expect(out).toContain('<Text Color="#000000000000">Black</Text>');
    expect(out).toContain('<Text>Plain</Text>');
  });

  it('keeps the AdornmentStyle tag on its run, with no invented Color', () => {
    const out = exportFDX(docOf(scene, para));
    expect(out).toContain('<Text AdornmentStyle="-1">Tagged</Text>');
  });
});

describe('character highlighting, on export', () => {
  const profile = (name: string, color: string, highlighted: boolean) =>
    ({ name, description: '', color, highlighted }) as never;

  it('writes Final Draft\'s placeholder colour and Visible when no colour is set', () => {
    const out = exportFDX(docOf(scene), 'T', [profile('ANSA', '', false)]);
    expect(out).toContain('<Character Color="#RRRRGGGGBBBB" Name="ANSA" Visible="No"/>');
  });

  it('writes a real colour in the 48-bit form, and Visible="Yes" when highlighted', () => {
    const out = exportFDX(docOf(scene), 'T', [profile('MAX', '#FF0000', true)]);
    expect(out).toContain('<Character Color="#FFFF00000000" Name="MAX" Visible="Yes"/>');
  });
});
