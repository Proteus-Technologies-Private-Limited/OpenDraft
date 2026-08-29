import { describe, it, expect } from 'vitest';
import {
  parseNoteContent,
  noteBlockText,
  noteContentText,
  isImageUrl,
  isVideoUrl,
  toEmbedUrl,
  type NoteAsset,
  type NoteRenderContext,
} from './noteContent';

const ASSETS: NoteAsset[] = [
  { id: 'a1', original_name: 'moon landing.jpg', mime_type: 'image/jpeg' },
  { id: 'a2', original_name: 'contract.pdf', mime_type: 'application/pdf' },
];

const ctx = (over: Partial<NoteRenderContext> = {}): NoteRenderContext => ({
  assets: ASSETS,
  assetUrl: (a) => `/assets/${a.id}`,
  ...over,
});

describe('url classification', () => {
  it('recognises image extensions, with or without a query', () => {
    expect(isImageUrl('https://x.test/a.png')).toBe(true);
    expect(isImageUrl('https://x.test/a.JPG?v=2')).toBe(true);
    expect(isImageUrl('https://x.test/a.txt')).toBe(false);
  });

  it('recognises video files and the two embed hosts', () => {
    expect(isVideoUrl('https://x.test/a.mp4')).toBe(true);
    expect(isVideoUrl('https://youtu.be/abc123')).toBe(true);
    expect(isVideoUrl('https://vimeo.com/12345')).toBe(true);
    expect(isVideoUrl('https://x.test/page')).toBe(false);
  });

  it('converts watch links to embed links', () => {
    expect(toEmbedUrl('https://www.youtube.com/watch?v=abc123'))
      .toBe('https://www.youtube-nocookie.com/embed/abc123');
    expect(toEmbedUrl('https://vimeo.com/12345'))
      .toBe('https://player.vimeo.com/video/12345');
    expect(toEmbedUrl('https://x.test/a.mp4')).toBeNull();
  });
});

describe('parseNoteContent', () => {
  it('is empty for an empty body', () => {
    expect(parseNoteContent('', ctx())).toEqual([]);
  });

  it('makes a bare image URL its own picture', () => {
    const b = parseNoteContent('https://x.test/moon.png', ctx());
    expect(b).toEqual([{ kind: 'image', url: 'https://x.test/moon.png', alt: '' }]);
  });

  it('keeps an image URL inside a sentence as a link, not a picture', () => {
    const b = parseNoteContent('see https://x.test/moon.png for detail', ctx());
    expect(b[0].kind).toBe('line');
  });

  it('treats a video URL as a video and keeps its embed form', () => {
    const [b] = parseNoteContent('https://youtu.be/abc123', ctx());
    expect(b).toMatchObject({ kind: 'video', embedUrl: 'https://www.youtube-nocookie.com/embed/abc123' });
  });

  it('resolves an @asset reference', () => {
    const [b] = parseNoteContent('cite @contract.pdf here', ctx());
    expect(b.kind).toBe('line');
    if (b.kind !== 'line') throw new Error('expected a line');
    const asset = b.parts.find((p) => p.kind === 'asset');
    expect(asset).toMatchObject({ ref: '@contract.pdf', url: '/assets/a2', isImage: false });
  });

  it('matches an asset whose name has spaces, via underscores', () => {
    const [b] = parseNoteContent('@moon_landing.jpg', ctx());
    // Alone on its line and an image, so it becomes a picture.
    expect(b).toMatchObject({ kind: 'image', url: '/assets/a1', alt: 'moon landing.jpg' });
  });

  it('leaves an image asset inline when it shares its line', () => {
    const [b] = parseNoteContent('shot: @moon_landing.jpg', ctx());
    expect(b.kind).toBe('line');
  });

  it('falls back to the literal reference when the asset cannot be resolved', () => {
    // A document opened without its project: better a visible @Name than nothing.
    const [b] = parseNoteContent('@moon_landing.jpg', ctx({ assetUrl: () => null }));
    expect(b.kind).toBe('line');
    expect(noteBlockText(b)).toBe('moon landing.jpg');
  });

  it('keeps an unknown reference as the writer typed it', () => {
    const [b] = parseNoteContent('@nope.txt', ctx());
    expect(noteBlockText(b)).toBe('@nope.txt');
  });

  it('gives one block per source line', () => {
    expect(parseNoteContent('one\ntwo\nthree', ctx())).toHaveLength(3);
  });
});

describe('printed text', () => {
  it('gives a picture no text — it is measured by height instead', () => {
    expect(noteBlockText({ kind: 'image', url: 'u', alt: '' })).toBe('');
  });

  it('degrades a video to its URL, since paper cannot play it', () => {
    expect(noteBlockText({ kind: 'video', url: 'https://youtu.be/x', embedUrl: null }))
      .toBe('https://youtu.be/x');
  });

  it('reads a whole note back as lines', () => {
    const blocks = parseNoteContent('Armstrong, N. (1969).\nNASA transcript.', ctx());
    expect(noteContentText(blocks)).toBe('Armstrong, N. (1969).\nNASA transcript.');
  });
});
