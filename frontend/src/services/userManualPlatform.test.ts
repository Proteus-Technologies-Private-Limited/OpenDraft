import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ os: 'unknown' as string, tauri: false }));
vi.mock('./platform', () => ({
  getOS: () => platform.os,
  hidesOtherMobilePlatforms: () => platform.tauri && (platform.os === 'ios' || platform.os === 'macos'),
  isMobileTauri: () => platform.tauri && (platform.os === 'ios' || platform.os === 'android'),
}));

import { dropOtherPlatformText } from './userManual';

/** The data-platform blocks a manual page has left once the filter ran. */
function shown(os: string, tauri: boolean): string[] {
  platform.os = os;
  platform.tauri = tauri;
  const blocks = ['android', 'apple'];
  const root = {
    querySelectorAll: (selector: string) => {
      const match = /^\[data-platform="(\w+)"\]$/.exec(selector);
      if (!match) throw new Error(`unexpected selector ${selector}`);
      return blocks
        .filter((b) => b === match[1])
        .map((b) => ({ remove: () => blocks.splice(blocks.indexOf(b), 1) }));
    },
  } as unknown as ParentNode;
  dropOtherPlatformText(root);
  return blocks;
}

describe('dropOtherPlatformText', () => {
  beforeEach(() => {
    platform.os = 'unknown';
    platform.tauri = false;
  });

  it('keeps both platforms in the web manual', () => {
    expect(shown('android', false)).toEqual(['android', 'apple']);
    expect(shown('ios', false)).toEqual(['android', 'apple']);
  });

  it('drops Android text in the Apple apps', () => {
    expect(shown('ios', true)).toEqual(['apple']);
    expect(shown('macos', true)).toEqual(['apple']);
  });

  it('drops iPhone and iPad text in the Android app', () => {
    expect(shown('android', true)).toEqual(['android']);
  });

  it('keeps both on the other desktop apps', () => {
    expect(shown('windows', true)).toEqual(['android', 'apple']);
    expect(shown('linux', true)).toEqual(['android', 'apple']);
  });
});
