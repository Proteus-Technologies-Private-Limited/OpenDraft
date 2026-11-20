/**
 * The PDF exporter's system-font fallback: it must cost nothing outside the
 * desktop app, hand back real bytes inside it, and never throw.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { systemFontForText } from './systemFonts';

let desktop = true;
vi.mock('../services/platform', () => ({ isDesktopTauri: () => desktop }));

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

beforeEach(() => {
  desktop = true;
  invoke.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('systemFontForText', () => {
  it('returns null without calling Tauri outside the desktop app', async () => {
    desktop = false;
    expect(await systemFontForText('日本語', false, false)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns null for text with nothing to cover', async () => {
    expect(await systemFontForText('  \n ', false, false)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('passes text, bold and italic to the command and returns the bytes', async () => {
    invoke.mockResolvedValue([0, 1, 0, 0, 7]);
    const out = await systemFontForText('日本語', true, false);
    expect(invoke).toHaveBeenCalledWith('system_font_for_text', { text: '日本語', bold: true, italic: false });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out!)).toEqual([0, 1, 0, 0, 7]);
  });

  it('accepts an ArrayBuffer response', async () => {
    invoke.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    expect(Array.from((await systemFontForText('x', false, true))!)).toEqual([1, 2, 3]);
  });

  it('returns null when no font covers the text', async () => {
    invoke.mockResolvedValue(null);
    expect(await systemFontForText('x', false, false)).toBeNull();
  });

  it('returns null for an empty payload', async () => {
    invoke.mockResolvedValue([]);
    expect(await systemFontForText('x', false, false)).toBeNull();
  });

  it('swallows a failing command and returns null', async () => {
    invoke.mockRejectedValue(new Error('boom'));
    expect(await systemFontForText('x', false, false)).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });
});
