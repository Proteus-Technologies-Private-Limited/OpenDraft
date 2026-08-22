import { describe, it, expect } from 'vitest';
import { readFontFileInfo, FontFileError } from './fontFile';

interface NameRecord {
  platformId: number;
  nameId: number;
  value: string;
  /** Defaults to US English for Windows records, English for Macintosh ones. */
  languageId?: number;
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
    view.setUint16(at + 4, r.languageId ?? (r.platformId === 3 ? 0x409 : 0)); // languageId
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

  it('reads the English name, not whichever language comes first', () => {
    // Every Microsoft-supplied font in /System/Library/Fonts/Supplemental lists
    // Spanish before English. Reading the first Windows record recorded
    // "Times New Roman Bold" as subfamily "Negreta", weight 400 — so an
    // installed bold weight had no bold.
    const font = buildFont([
      { platformId: 3, nameId: 1, value: 'Times New Roman', languageId: 0x0c0a },
      { platformId: 3, nameId: 2, value: 'Negreta cursiva', languageId: 0x0c0a },
      { platformId: 3, nameId: 1, value: 'Times New Roman', languageId: 0x0409 },
      { platformId: 3, nameId: 2, value: 'Bold Italic', languageId: 0x0409 },
    ]);
    const info = readFontFileInfo(font, 'Times New Roman Bold Italic.ttf');
    expect(info.subfamily).toBe('Bold Italic');
    expect(info.weight).toBe(700);
    expect(info.italic).toBe(true);
  });

  it('falls back to another language rather than reporting no name', () => {
    const font = buildFont([
      { platformId: 3, nameId: 1, value: 'Zapfino', languageId: 0x0404 },
      { platformId: 3, nameId: 2, value: '標準體', languageId: 0x0404 },
    ]);
    expect(readFontFileInfo(font, 'Zapfino.ttf').family).toBe('Zapfino');
  });

  it('reads the first font out of a TrueType collection', () => {
    // 79 of the fonts macOS ships are .ttc. Guessing their names from filenames
    // threw away the weight and slant of every one of them.
    const inner = buildFont([
      { platformId: 3, nameId: 1, value: 'Snell Roundhand' },
      { platformId: 3, nameId: 2, value: 'Black' },
    ]);
    const HEADER = 16;
    const collection = new ArrayBuffer(HEADER + inner.byteLength);
    const view = new DataView(collection);
    view.setUint32(0, 0x74746366); // 'ttcf'
    view.setUint16(4, 1); // major version
    view.setUint32(8, 1); // numFonts
    view.setUint32(12, HEADER); // offset of the first table directory
    new Uint8Array(collection).set(new Uint8Array(inner), HEADER);
    // Table offsets inside a collection are absolute, so they have to be
    // shifted by where the directory landed.
    const innerView = new DataView(collection);
    const numTables = innerView.getUint16(HEADER + 4);
    for (let i = 0; i < numTables; i++) {
      const record = HEADER + 12 + i * 16;
      innerView.setUint32(record + 8, innerView.getUint32(record + 8) + HEADER);
    }

    const info = readFontFileInfo(collection, 'SnellRoundhand.ttc');
    expect(info.family).toBe('Snell Roundhand');
    expect(info.weight).toBe(900);
    expect(info.fromFile).toBe(true);
  });

  it('refuses something that is not a font at all', () => {
    const buffer = new TextEncoder().encode('this is a readme, not a font').buffer;
    expect(() => readFontFileInfo(buffer, 'README.txt')).toThrow(FontFileError);
  });

  it('refuses a file too short to hold a header', () => {
    expect(() => readFontFileInfo(new ArrayBuffer(4), 'stub.ttf')).toThrow(FontFileError);
  });
});
