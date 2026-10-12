/**
 * Final Draft's "Collated Revisions" header label and WriTea Draft's {revision} token.
 */
import { describe, it, expect } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { exportFDX } from './fdxExporter';
import { parseHeaderAndFooter } from './fdxParser';

const scene = { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. HOUSE - DAY' }] };

describe('the revisions label in a header', () => {
  it('is written as Final Draft\'s Collated Revisions label', () => {
    const layout = { headerContent: { left: '', center: '', right: '{revision} {page}.' }, headerStartPage: 1 };
    const xml = exportFDX(
      { type: 'doc', content: [scene] } as Parameters<typeof exportFDX>[0],
      'T',
      undefined, undefined, undefined, undefined, undefined,
      layout as never,
    );
    expect(xml).toContain('<DynamicLabel Type="Collated Revisions"/>');
    expect(xml).toContain('<DynamicLabel Type="Page #"/>');
  });

  it('is read back as the {revision} token', () => {
    const xml = `<?xml version="1.0"?><FinalDraft><HeaderAndFooter FooterVisible="No" HeaderVisible="Yes" HeaderFirstPage="No" FooterFirstPage="No" StartingPage="1"><Header><Paragraph Alignment="Right"><DynamicLabel Type="Collated Revisions"/><Text> </Text><DynamicLabel Type="Page #"/><Text>.</Text></Paragraph></Header></HeaderAndFooter></FinalDraft>`;
    const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
    const out = JSON.stringify(parseHeaderAndFooter(doc));
    expect(out).toContain('{revision}');
    expect(out).toContain('{page}');
  });
});
