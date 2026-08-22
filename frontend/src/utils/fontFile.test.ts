import { describe, it, expect } from 'vitest';
import { readFontFileInfo, FontFileError } from './fontFile';

interface NameRecord {
  platformId: number;
  nameId: number;
  value: string;
}

/**
 * The smallest thing that is still a font as far as the name reader is
 * concerned: an sfnt header, one table record, and a `name` table.
 */
function buildFont(records: NameRecord[], sfntTag = 0x00010000): ArrayBuffer {
  const encoded = records.map((r) => {
    if (r.platformId === 1) {
      return { ...r, bytes: Uint8Array.from([...r.value].map((c) => c.charCodeAt(0))) };
    }
    const bytes = new Uint8Array(r.value.length * 2);
    [...r.value].forEach((c, i) => {
      bytes[i * 2] = c.charCodeAt(0) >> 8;
      bytes[i * 2 + 1] = c.charCodeAt(0) & 0xff;
    });
    return { ...r, bytes };
  });

  const HEADER = 12;
  const RECORD = 16;
  const nameOffset = HEADER + RECORD;
  const stringOffset = 6 + encoded.length * 12;
  const stringsLength = encoded.reduce((n, r) => n + r.bytes.length, 0);
  const nameLength = stringOffset + stringsLength;

  const buffer = new ArrayBuffer(nameOffset + nameLength);
  const view = new DataView(buffer);

  view.setUint32(0, sfntTag);
  view.setUint16(4, 1); // numTables
  view.setUint32(HEADER, 0x6e616d65); // 'name'
  view.setUint32(HEADER + 4, 0); // checksum
  view.setUint32(HEADER + 8, nameOffset);
  view.setUint32(HEADER + 12, nameLength);

  view.setUint16(nameOffset, 0); // format
  view.setUint16(nameOffset + 2, encoded.length);
  view.setUint16(nameOffset + 4, stringOffset);

  let cursor = 0;
  encoded.forEach((r, i) => {
    const at = nameOffset + 6 + i * 12;
    view.setUint16(at, r.platformId);
    view.setUint16(at + 2, r.platformId === 3 ? 1 : 0); // encodingId
    view.setUint16(at + 4, r.platformId === 3 ? 0x409 : 0); // languageId
    view.setUint16(at + 6, r.nameId);
    view.setUint16(at + 8, r.bytes.length);
    view.setUint16(at + 10, cursor);
    new Uint8Array(buffer).set(r.bytes, nameOffset + stringOffset + cursor);
    cursor += r.bytes.length;
  });

  return buffer;
}

describe('readFontFileInfo', () => {
  it('takes the family from the file, not the filename', () => {
    const font = buildFont([
      { platformId: 3, nameId: 1, value: 'Courier Prime' },
      { platformId: 3, nameId: 2, value: 'Bold Italic' },
    ]);
    const info = readFontFileInfo(font, 'CourierPrime-BoldItalic.ttf');
    expect(info.family).toBe('Courier Prime');
    expect(info.subfamily).toBe('Bold Italic');
    expect(info.weight).toBe(700);
    expect(info.italic).toBe(true);
    expect(info.fromFile).toBe(true);
  });

  it('prefers the typographic family, so weights of one family group together', () => {
    // A semibold cut names itself "Foo Semibold" in nameID 1 so that old
    // applications see four-style families; nameID 16 is the real family.
    const font = buildFont([
      { platformId: 3, nameId: 1, value: 'Source Serif Semibold' },
      { platformId: 3, nameId: 16, value: 'Source Serif 4' },
      { platformId: 3, nameId: 17, value: 'Semibold' },
    ]);
    const info = readFontFileInfo(font, 'SourceSerif4-Semibold.otf');
    expect(info.family).toBe('Source Serif 4');
    expect(info.weight).toBe(600);
    expect(info.italic).toBe(false);
  });

  it('reads OpenType (OTTO) files as well as TrueType', () => {
    const font = buildFont([{ platformId: 3, nameId: 1, value: 'Cinzel' }], 0x4f54544f);
    expect(readFontFileInfo(font, 'whatever.otf').family).toBe('Cinzel');
  });

  it('takes the Windows name over the Macintosh one', () => {
    const font = buildFont([
      { platformId: 1, nameId: 1, value: 'Mac Name' },
      { platformId: 3, nameId: 1, value: 'Windows Name' },
    ]);
    expect(readFontFileInfo(font, 'x.ttf').family).toBe('Windows Name');
  });

  it('falls back to the filename for a compressed WOFF, which still renders', () => {
    const buffer = new ArrayBuffer(64);
    new DataView(buffer).setUint32(0, 0x774f4632); // 'wOF2'
    const info = readFontFileInfo(buffer, 'Special-Elite-Bold.woff2');
    expect(info.family).toBe('Special Elite');
    expect(info.weight).toBe(700);
    expect(info.fromFile).toBe(false);
  });

  it('falls back to the filename when the name table is missing', () => {
    const buffer = new ArrayBuffer(28);
    const view = new DataView(buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, 1);
    view.setUint32(12, 0x676c7966); // 'glyf' — no name table at all
    expect(readFontFileInfo(buffer, 'MyFont-Regular.ttf').family).toBe('My Font');
  });

  it('refuses something that is not a font at all', () => {
    const buffer = new TextEncoder().encode('this is a readme, not a font').buffer;
    expect(() => readFontFileInfo(buffer, 'README.txt')).toThrow(FontFileError);
  });

  it('refuses a file too short to hold a header', () => {
    expect(() => readFontFileInfo(new ArrayBuffer(4), 'stub.ttf')).toThrow(FontFileError);
  });
});
