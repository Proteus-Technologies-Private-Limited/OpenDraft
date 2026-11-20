/**
 * Cutting a font down to the characters a document uses.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { subsetFont } from './fontSubset';

const FONT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'fonts', 'NotoSansKhmer-Regular.ttf');

/** The code points a font's format 4 cmap maps, enough to see what survived. */
function mapped(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = view.getUint16(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const at = 12 + i * 16;
    if (String.fromCharCode(...bytes.subarray(at, at + 4)) === 'cmap') cmap = view.getUint32(at + 8);
  }
  const out: number[] = [];
  const n = view.getUint16(cmap + 2);
  for (let i = 0; i < n; i++) {
    const sub = cmap + view.getUint32(cmap + 4 + i * 8 + 4);
    if (view.getUint16(sub) !== 4) continue;
    const segs = view.getUint16(sub + 6) / 2;
    const ends = sub + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
    for (let s = 0; s < segs; s++) {
      const end = view.getUint16(ends + s * 2), start = view.getUint16(starts + s * 2), ro = view.getUint16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g = ro === 0 ? (c + view.getInt16(deltas + s * 2)) & 0xffff : view.getUint16(ranges + s * 2 + ro + (c - start) * 2);
        if (ro !== 0 && g !== 0) g = (g + view.getInt16(deltas + s * 2)) & 0xffff;
        if (g !== 0) out.push(c);
      }
    }
  }
  return out;
}

describe('subsetFont', () => {
  const whole = new Uint8Array(readFileSync(FONT));

  it('keeps the characters asked for and drops the rest', async () => {
    const cut = await subsetFont(whole, [0x1780, 0x1781, 0x20]);
    expect(cut).not.toBeNull();
    const kept = mapped(cut!);
    expect(kept).toEqual(expect.arrayContaining([0x1780, 0x1781, 0x20]));
    expect(kept).not.toContain(0x1790);
    expect(kept).not.toContain(0x41);
  });

  it('is a valid TrueType file, far smaller than the whole', async () => {
    const cut = await subsetFont(whole, [0x1780]);
    expect([...cut!.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
    expect(cut!.length).toBeLessThan(whole.length / 5);
  });

  it('does not disturb the font it was given', async () => {
    const before = whole.slice(0, 64);
    await subsetFont(whole, [0x1780]);
    expect(whole.slice(0, 64)).toEqual(before);
  });

  it('gives back null for bytes that are not a font, rather than throwing', async () => {
    expect(await subsetFont(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), [0x41])).toBeNull();
  });
});
