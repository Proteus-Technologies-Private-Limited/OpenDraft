import { describe, it, expect } from 'vitest';
import { encodeWav16 } from './wav';

describe('encodeWav16', () => {
  it('writes a 16-bit PCM mono WAV that every audio element can play', () => {
    const wav = encodeWav16(new Float32Array([0, 1, -1, 0.5, 2]), 24000);
    const v = new DataView(wav);
    const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(v.getUint16(20, true)).toBe(1); // PCM, not 3 (float)
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(10);
    expect(wav.byteLength).toBe(54);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
    expect(v.getInt16(52, true)).toBe(32767); // clipped, not wrapped
  });
});
