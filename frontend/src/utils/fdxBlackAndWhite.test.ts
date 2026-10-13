/**
 * Black and white FDX: every colour goes, nothing else does.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { toBlackAndWhiteFdx } from './fdxBlackAndWhite';

const sample = [
  '<FinalDraft><Content>',
  '<Paragraph Type="Action"><Text Background="#FFFF00000000" Color="#00000000FFFF" Font="Courier Final Draft" Size="12">Hi there</Text></Paragraph>',
  '</Content>',
  '<ElementSettings Type="Action"><FontSpec Background="#CCCC0000CCCC" Color="#FFFF00000000" Font="Courier Final Draft" Size="12" Style=""/></ElementSettings>',
  '<PageLayout BackgroundColor="#FFFF00000000" ForegroundColor="#0000FFFF0000" BottomMargin="72"/>',
  '<Revisions><Revision Color="#112233445566" ID="1"/></Revisions>',
  '<TagData><TagCategory CatId="1" Name="Props" Color="#ff0000"/></TagData>',
  '<CharacterHighlighting><Character Color="#0000FFFF0000" Name="ANNA" Visible="Yes"/></CharacterHighlighting>',
  '</FinalDraft>',
].join('\n');

describe('toBlackAndWhiteFdx', () => {
  const out = toBlackAndWhiteFdx(sample);

  it('makes every text run and element setting black on white', () => {
    expect(out).toContain('<Text Background="#FFFFFFFFFFFF" Color="#000000000000" Font="Courier Final Draft" Size="12">Hi there</Text>');
    expect(out).toContain('<FontSpec Background="#FFFFFFFFFFFF" Color="#000000000000" Font="Courier Final Draft" Size="12" Style=""/>');
  });

  it('makes the page black on white', () => {
    expect(out).toContain('<PageLayout BackgroundColor="#FFFFFFFFFFFF" ForegroundColor="#000000000000" BottomMargin="72"/>');
  });

  it('switches character highlighting off', () => {
    expect(out).toContain('<Character Color="#000000000000" Name="ANNA" Visible="No"/>');
  });

  it('leaves revisions and tag categories alone', () => {
    expect(out).toContain('<Revision Color="#112233445566" ID="1"/>');
    expect(out).toContain('<TagCategory CatId="1" Name="Props" Color="#ff0000"/>');
  });

  it('is the same file when run twice', () => {
    expect(toBlackAndWhiteFdx(out)).toBe(out);
  });
});
