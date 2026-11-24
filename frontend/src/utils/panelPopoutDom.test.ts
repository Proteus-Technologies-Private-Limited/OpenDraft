import { describe, expect, it } from 'vitest';
import { MIN_PANEL_WINDOW, cascade, onSomeDisplay, parseBounds, placePanelWindow, popupFeatures, shouldForwardShortcut } from './panelPopoutDom';

const key = (key: string, mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean }> = {}, tagName?: string, editable = false) => ({
  key, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, altKey: !!mods.alt,
  target: tagName ? { tagName, isContentEditable: editable } as unknown as EventTarget : null,
});

describe('shortcuts typed in a panel window', () => {
  it('passes app shortcuts on to the editor window', () => {
    expect(shouldForwardShortcut(key('s', { meta: true }))).toBe(true);
    expect(shouldForwardShortcut(key('s', { ctrl: true }, 'DIV'))).toBe(true);
    expect(shouldForwardShortcut(key('F5'))).toBe(true);
    // Undo outside a field undoes in the script.
    expect(shouldForwardShortcut(key('z', { meta: true }, 'BUTTON'))).toBe(true);
  });

  it('leaves plain typing and a field’s own editing keys to the panel', () => {
    expect(shouldForwardShortcut(key('a'))).toBe(false);
    expect(shouldForwardShortcut(key('Enter'))).toBe(false);
    expect(shouldForwardShortcut(key('Escape'))).toBe(false);
    for (const k of ['a', 'c', 'v', 'x', 'z', 'Z', 'y']) {
      expect(shouldForwardShortcut(key(k, { meta: true }, 'INPUT'))).toBe(false);
      expect(shouldForwardShortcut(key(k, { ctrl: true }, 'TEXTAREA'))).toBe(false);
      expect(shouldForwardShortcut(key(k, { meta: true }, 'DIV', true))).toBe(false);
    }
    // Saving from a field still saves.
    expect(shouldForwardShortcut(key('s', { meta: true }, 'INPUT'))).toBe(true);
  });
});

describe('remembered panel window bounds', () => {
  it('reads only complete, finite bounds', () => {
    expect(parseBounds(JSON.stringify({ left: 10, top: 20, width: 300, height: 400 }))).toEqual({ left: 10, top: 20, width: 300, height: 400 });
    expect(parseBounds(null)).toBeNull();
    expect(parseBounds('not json')).toBeNull();
    expect(parseBounds(JSON.stringify({ left: 10, top: 20, width: 300 }))).toBeNull();
    expect(parseBounds(JSON.stringify({ left: 'x', top: 20, width: 300, height: 400 }))).toBeNull();
    expect(parseBounds('{"left":1e999,"top":0,"width":1,"height":1}')).toBeNull();
  });

  const primary = { left: 0, top: 25, width: 1440, height: 875 };
  const second = { left: 1440, top: 0, width: 1920, height: 1080 };
  const editor = { left: 100, top: 60, width: 800, height: 700 };
  const size = { width: 380, height: 640 };

  it('reopens where it was while that display is connected', () => {
    const saved = { left: 2000, top: 100, width: 420, height: 700 };
    expect(placePanelWindow(saved, editor, primary, [primary, second], size)).toEqual(saved);
  });

  it('comes back beside the editor when its display is gone', () => {
    const saved = { left: 2000, top: 100, width: 420, height: 700 };
    const placed = placePanelWindow(saved, editor, primary, [primary], size);
    expect(onSomeDisplay(placed, [primary])).toBe(true);
    expect(placed.left).toBe(editor.left + editor.width + 8);
    expect(placed.width).toBe(420);
  });

  it('opens to the left when there is no room on the right, and never off screen', () => {
    const wide = { left: 500, top: 60, width: 900, height: 800 };
    const placed = placePanelWindow(null, wide, primary, [primary], size);
    expect(placed.left).toBe(500 - 380 - 8);
    const full = { left: 0, top: 25, width: 1440, height: 875 };
    const over = placePanelWindow(null, full, primary, [primary], size);
    expect(over.left).toBeGreaterThanOrEqual(primary.left);
    expect(over.left + over.width).toBeLessThanOrEqual(primary.left + primary.width);
    expect(over.top + over.height).toBeLessThanOrEqual(primary.top + primary.height);
  });

  it('trusts the saved place when the displays are unknown (a browser keeps it on screen)', () => {
    const saved = { left: 5000, top: 100, width: 420, height: 700 };
    expect(placePanelWindow(saved, editor, primary, null, size)).toEqual(saved);
  });

  it('never opens smaller than a usable panel', () => {
    const tiny = { left: 10, top: 40, width: 20, height: 30 };
    const placed = placePanelWindow(tiny, editor, primary, [primary], size);
    expect(placed.width).toBe(MIN_PANEL_WINDOW.width);
    expect(placed.height).toBe(MIN_PANEL_WINDOW.height);
  });

  it('a window whose title bar is off every display is not reachable', () => {
    expect(onSomeDisplay({ left: -900, top: 100, width: 400, height: 600 }, [primary])).toBe(false);
    expect(onSomeDisplay({ left: 100, top: 2000, width: 400, height: 600 }, [primary])).toBe(false);
    expect(onSomeDisplay({ left: -300, top: 100, width: 400, height: 600 }, [primary])).toBe(true);
    expect(onSomeDisplay({ left: -370, top: 100, width: 400, height: 600 }, [primary])).toBe(false);
  });

  it('steps a new window off one already open in the same spot', () => {
    const b = { left: 100, top: 100, width: 380, height: 640 };
    expect(cascade(b, [])).toEqual(b);
    expect(cascade(b, [{ left: 500, top: 100 }])).toEqual(b);
    expect(cascade(b, [{ left: 104, top: 98 }])).toMatchObject({ left: 128, top: 128 });
    expect(cascade(b, [{ left: 100, top: 100 }, { left: 128, top: 128 }])).toMatchObject({ left: 156, top: 156 });
  });

  it('asks for a popup window, not a tab', () => {
    expect(popupFeatures({ left: 1, top: 2, width: 3, height: 4 })).toBe('popup=yes,left=1,top=2,width=3,height=4');
  });
});
