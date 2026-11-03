/**
 * Turning page numbers off must remove the whole field phrase, not just the
 * numbers: "Page {page} of {pages}" used to become "Page of".
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

// pdfExporter imports jsPDF and the file layer at module load; neither is used
// by withoutPageFields, so keep them out of the way.
vi.mock('jspdf', () => ({ default: class {} }));
vi.mock('./fileOps', () => ({ saveFile: vi.fn(async () => {}) }));

const { withoutPageFields } = await import('./pdfExporter');

const clean = (center: string): string =>
  withoutPageFields({ left: '', center, right: '' }).center;

describe('withoutPageFields', () => {
  it('drops the whole "Page X of Y" phrase', () => {
    expect(clean('Page {page} of {pages}')).toBe('');
    expect(clean('Page {page} of {pages}.')).toBe('');
  });

  it('keeps the rest of the line', () => {
    expect(clean('Draft - Page {page} of {pages}')).toBe('Draft');
  });

  it('drops a comma, colon or semicolon that introduced the field', () => {
    // These separators introduce the removed phrase, rather than follow it.
    expect(clean('Draft: Page {page}')).toBe('Draft');
    expect(clean('Draft, Page {page}')).toBe('Draft');
    expect(clean('Draft; Page {page}')).toBe('Draft');
  });

  it('keeps attached punctuation on text after a leading page field', () => {
    expect(clean('Page {page} - Draft:')).toBe('Draft:');
    expect(clean('Page {page} - Draft,')).toBe('Draft,');
    expect(clean('Page {page} - Draft;')).toBe('Draft;');
    expect(clean('(Page {page}) - Draft:')).toBe('Draft:');
  });

  it('still drops a separator before a trailing field when fields appear at both ends', () => {
    expect(clean('Page {page} - Draft: Page {page}')).toBe('Draft');
    expect(clean('Page {page} - Draft; ({page}).')).toBe('Draft');
  });

  it('preserves trailing text punctuation in all header/footer slots', () => {
    expect(withoutPageFields({
      left: 'Page {page} - Draft:',
      center: '{page} / {pages} - Notes;',
      right: 'Page {page} - Rev.,',
    })).toEqual({ left: 'Draft:', center: 'Notes;', right: 'Rev.,' });
  });

  it('repeats the edge trims after removing a template full stop', () => {
    // Removing the full stop exposes the dash, which must then go too.
    expect(clean('Draft - {page}.')).toBe('Draft');
    expect(clean('Draft - Page {page} of {pages}.')).toBe('Draft');
  });

  it('drops empty brackets left around a removed field', () => {
    expect(clean('Draft (Page {page})')).toBe('Draft');
    expect(clean('Draft [{page}]')).toBe('Draft');
  });

  it('keeps the writer\'s punctuation when a page field follows it', () => {
    expect(clean('Blue Rev. Page {page}')).toBe('Blue Rev.');
    expect(clean('Blue Rev. Page {page} of {pages}')).toBe('Blue Rev.');
    expect(clean('Blue Rev. - Page {page}')).toBe('Blue Rev.');
    // A full stop that trails the field is the template's, not the writer's.
    expect(clean('Page {page} of {pages}.')).toBe('');
  });

  it('drops a page field on its own', () => {
    expect(clean('{page}')).toBe('');
    expect(clean('Page {page}')).toBe('');
    expect(clean('{page} / {pages}')).toBe('');
    expect(clean('{page}.')).toBe('');
  });

  it('handles the usual words in other languages', () => {
    expect(clean('Página {page} de {pages}')).toBe('');
  });

  it('leaves a line with no page fields as it was', () => {
    expect(clean('CONFIDENTIAL')).toBe('CONFIDENTIAL');
    expect(clean('Draft - 2nd pass')).toBe('Draft - 2nd pass');
    // Punctuation on such a line is the writer's, not something to tidy away.
    expect(clean('Blue Rev.')).toBe('Blue Rev.');
    expect(clean('Blue Rev. -')).toBe('Blue Rev. -');
  });
});
