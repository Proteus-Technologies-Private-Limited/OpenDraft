import { describe, it, expect } from 'vitest';
import { looksLikeTreatment, normalizeFormat } from './scriptFormat';

describe('looksLikeTreatment', () => {
  it('recognises what the treatment editor writes', () => {
    expect(looksLikeTreatment({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true);
    expect(looksLikeTreatment({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'ACT ONE' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'A writer loses her script.' }] },
        { type: 'bulletList', content: [] },
      ],
    })).toBe(true);
  });

  it('never mistakes a screenplay for one', () => {
    expect(looksLikeTreatment({
      type: 'doc',
      content: [
        { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. OFFICE - DAY' }] },
        { type: 'action', content: [{ type: 'text', text: 'She types.' }] },
      ],
    })).toBe(false);
    // A screenplay with one stray prose block is still a screenplay.
    expect(looksLikeTreatment({ type: 'doc', content: [{ type: 'action' }, { type: 'paragraph' }] })).toBe(false);
  });

  it('says no to anything it cannot read', () => {
    expect(looksLikeTreatment(null)).toBe(false);
    expect(looksLikeTreatment({ type: 'doc', content: [] })).toBe(false);
    expect(looksLikeTreatment('paragraph')).toBe(false);
  });
});

describe('normalizeFormat', () => {
  it('defaults to screenplay', () => {
    expect(normalizeFormat(undefined)).toBe('screenplay');
    expect(normalizeFormat('')).toBe('screenplay');
    expect(normalizeFormat('treatment')).toBe('treatment');
    // The web backend's legacy default, arriving in a web project export.
    expect(normalizeFormat('json')).toBe('screenplay');
  });
});
