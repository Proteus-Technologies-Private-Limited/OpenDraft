/**
 * A note's own highlight must not survive a paste as a second mark.
 *
 * The bug: PastedHighlight matches any inline `background-color`, which is
 * exactly what a script note's span carries. Copying a noted passage and
 * pasting it back therefore laid a translucent highlight over the same words,
 * and deleting the note removed only the note's own mark — the colour stayed on
 * a passage that no longer had a note.
 */
import { describe, it, expect } from 'vitest';
import { stripNoteBackgrounds } from './stripNoteBackgrounds';

const NOTE_SPAN =
  '<span data-note-id="n1" data-note-color="#f4d35e" '
  + 'style="background-color: #f4d35e33; border-bottom: 2px solid #f4d35e;" '
  + 'class="script-note-highlight">noted</span>';

describe('stripNoteBackgrounds', () => {
  it('takes the background off a note span', () => {
    const out = stripNoteBackgrounds(NOTE_SPAN);
    expect(out).not.toMatch(/background-color/i);
  });

  it('leaves everything else about the span alone', () => {
    const out = stripNoteBackgrounds(NOTE_SPAN);
    expect(out).toContain('data-note-id="n1"');
    expect(out).toContain('data-note-color="#f4d35e"');
    expect(out).toContain('border-bottom: 2px solid #f4d35e');
    expect(out).toContain('>noted</span>');
  });

  it('does the same for a production tag', () => {
    const tag = '<span data-tag-id="t1" style="background-color: #9370DB40; border-bottom: 2px solid #9370DB;">tagged</span>';
    const out = stripNoteBackgrounds(tag);
    expect(out).not.toMatch(/background-color/i);
    expect(out).toContain('data-tag-id="t1"');
  });

  it('leaves a highlight the writer really pasted', () => {
    // The rule earns its keep on this one: it has no note or tag id.
    const pasted = '<span style="background-color: rgb(255, 230, 153);">from Docs</span>';
    expect(stripNoteBackgrounds(pasted)).toBe(pasted);
  });

  it('leaves ordinary markup untouched', () => {
    const plain = '<p>A busy coffee shop in <strong>downtown</strong> Los Angeles.</p>';
    expect(stripNoteBackgrounds(plain)).toBe(plain);
  });

  it('drops the style attribute when nothing else was in it', () => {
    const only = '<span data-note-id="n1" style="background-color: #f4d35e33;">x</span>';
    const out = stripNoteBackgrounds(only);
    expect(out).not.toMatch(/style=/);
    expect(out).toContain('data-note-id="n1"');
  });

  it('handles the background shorthand and single quotes', () => {
    const shorthand = "<span data-note-id='n1' style='background: #f4d35e33; color: red'>x</span>";
    const out = stripNoteBackgrounds(shorthand);
    expect(out).not.toMatch(/background/i);
    expect(out).toContain('color: red');
  });

  it('strips every note span in a longer passage, keeping the writer’s own', () => {
    const html = `<p>${NOTE_SPAN} and <span style="background-color: rgb(255, 230, 153);">theirs</span> and ${NOTE_SPAN}</p>`;
    const out = stripNoteBackgrounds(html);
    expect(out.match(/background-color/gi)).toHaveLength(1);
    expect(out).toContain('rgb(255, 230, 153)');
  });

  it('is a no-op on text with no note spans at all', () => {
    expect(stripNoteBackgrounds('')).toBe('');
    expect(stripNoteBackgrounds('plain text')).toBe('plain text');
  });
});
