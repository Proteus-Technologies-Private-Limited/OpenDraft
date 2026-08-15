/**
 * The name an exported file is offered under.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { sanitizeExportFilename } from './exportFilename';

describe('sanitizeExportFilename', () => {
  it('keeps a title written in any script', () => {
    // Issue #71: the old sanitizer kept only [a-zA-Z0-9_- ], so a Cyrillic
    // screenplay was saved as "Untitled".
    expect(sanitizeExportFilename('Тихий Дон')).toBe('Тихий Дон');
    expect(sanitizeExportFilename('Το Νησί')).toBe('Το Νησί');
    expect(sanitizeExportFilename('Café Noir')).toBe('Café Noir');
    expect(sanitizeExportFilename("L'Été — Acte 1")).toBe("L'Été — Acte 1");
  });

  it('leaves an ordinary Latin title exactly as it was', () => {
    expect(sanitizeExportFilename('The Big Sleep')).toBe('The Big Sleep');
    expect(sanitizeExportFilename('Act_1-Draft 3')).toBe('Act_1-Draft 3');
  });

  it('drops what a filesystem would refuse', () => {
    expect(sanitizeExportFilename('Act 1/2')).toBe('Act 12');
    expect(sanitizeExportFilename('Who? What: "Why"')).toBe('Who What Why');
    expect(sanitizeExportFilename('a\\b|c<d>e*f')).toBe('abcdef');
    expect(sanitizeExportFilename('line\nbreak')).toBe('linebreak');
  });

  it('will not produce a hidden, empty or trailing-dot name', () => {
    expect(sanitizeExportFilename('.hidden')).toBe('hidden');
    expect(sanitizeExportFilename('..')).toBe('Untitled');
    expect(sanitizeExportFilename('Draft...')).toBe('Draft');
    expect(sanitizeExportFilename('   ')).toBe('Untitled');
    expect(sanitizeExportFilename('')).toBe('Untitled');
    expect(sanitizeExportFilename('///')).toBe('Untitled');
  });

  it('collapses runs of whitespace, so the name stays one line', () => {
    expect(sanitizeExportFilename('  The   Long    Goodbye  ')).toBe('The Long Goodbye');
  });

  it('stays short enough for a filesystem to accept with its extension', () => {
    const long = sanitizeExportFilename('Э'.repeat(400));
    expect(long.length).toBeLessThanOrEqual(120);
  });
});
