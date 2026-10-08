/** WAV encoding for Table Read's on-device voices. */

/**
 * 16-bit PCM WAV from float samples.
 *
 * Kokoro's own `toWav()` writes 32-bit float WAV, which Chrome's audio
 * element will not load at all — no error, no metadata, the read simply
 * hangs on its first line. 16-bit PCM plays everywhere.
 */
export function encodeWav16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) v.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);          // fmt chunk size
  v.setUint16(20, 1, true);           // PCM
  v.setUint16(22, 1, true);           // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true);           // block align
  v.setUint16(34, 16, true);          // bits per sample
  ascii(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return buffer;
}
