import { afterEach, describe, expect, it, vi } from 'vitest';
import { tableReadMediaSession } from './mediaSession';

afterEach(() => vi.unstubAllGlobals());
describe('Table Read media controls', () => {
  it('maps play/pause and line steps, updates metadata and releases the session', () => {
    const handlers = new Map<string, (() => void) | null>();
    const session = { metadata: null, playbackState: 'none', setActionHandler: (action: string, handler: (() => void) | null) => handlers.set(action, handler) };
    vi.stubGlobal('MediaMetadata', class { title: string; artist: string;
      constructor(init: MediaMetadataInit) { this.title=init.title ?? ''; this.artist=init.artist ?? ''; }
    });
    const commands = { play: vi.fn(), pause: vi.fn(), stop: vi.fn(), nexttrack: vi.fn(), previoustrack: vi.fn() };
    const media = tableReadMediaSession(session as unknown as MediaSession, commands);
    handlers.get('nexttrack')?.(); handlers.get('previoustrack')?.(); handlers.get('pause')?.(); handlers.get('play')?.();
    for (const action of ['play', 'pause', 'nexttrack', 'previoustrack'] as const) expect(commands[action]).toHaveBeenCalledOnce();
    media.update({ status: 'playing', title: 'INT. STUDIO - NIGHT', speaker: 'SARAH' });
    expect(session.playbackState).toBe('playing');
    expect(session.metadata).toMatchObject({ title: 'INT. STUDIO - NIGHT', artist: 'SARAH' });
    media.update({ status: 'paused', title: 'INT. STUDIO - NIGHT', speaker: 'SARAH' });
    expect(session.playbackState).toBe('paused');
    media.dispose();
    expect(session.playbackState).toBe('none'); expect(session.metadata).toBeNull();
    expect([...handlers.values()].every(value => value === null)).toBe(true);
  });
  it('handles partial support without disabling the remaining controls', () => {
    const setActionHandler = vi.fn((action: string) => { if (action === 'nexttrack') throw new Error('unsupported'); });
    const commands = { play: vi.fn(), pause: vi.fn(), stop: vi.fn(), nexttrack: vi.fn(), previoustrack: vi.fn() };
    const session = { setActionHandler, playbackState: 'none', metadata: null } as unknown as MediaSession;
    const media = tableReadMediaSession(session, commands);
    expect(setActionHandler).toHaveBeenCalledWith('previoustrack', commands.previoustrack);
    media.update({ status: 'error', title: '', speaker: '' });
    expect(session.playbackState).toBe('none');
    expect(() => media.dispose()).not.toThrow();
  });
});
