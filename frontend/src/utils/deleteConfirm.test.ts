import { describe, expect, it } from 'vitest';
import { confirmNameMatches, confirmTargetName, normalizeConfirmName } from './deleteConfirm';

describe('confirmNameMatches', () => {
  it('matches the exact name', () => {
    expect(confirmNameMatches('Pilot Draft 2', 'Pilot Draft 2')).toBe(true);
  });

  it('ignores case and the spacing a phone keyboard adds', () => {
    expect(confirmNameMatches('pilot draft 2 ', 'Pilot Draft 2')).toBe(true);
    expect(confirmNameMatches('  PILOT   DRAFT 2', 'Pilot Draft 2')).toBe(true);
  });

  it('treats typographic dashes and quotes as the plain ones', () => {
    expect(confirmNameMatches('Pilot - Draft 2', 'Pilot – Draft 2')).toBe(true);
    expect(confirmNameMatches("Maya's Story", 'Maya’s Story')).toBe(true);
    expect(confirmNameMatches('The “Last” Night', 'The "Last" Night')).toBe(true);
  });

  it('matches Indic titles typed in either Unicode form', () => {
    const composed = 'क़िस्सा';
    const decomposed = composed.normalize('NFD');
    expect(confirmNameMatches(decomposed, composed)).toBe(true);
    expect(confirmNameMatches('எப்போது', 'எப்போது')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(confirmNameMatches('', 'Pilot Draft 2')).toBe(false);
    expect(confirmNameMatches('Pilot Draft', 'Pilot Draft 2')).toBe(false);
    expect(confirmNameMatches('Pilot Draft 22', 'Pilot Draft 2')).toBe(false);
  });

  it('never matches an empty box, even for a script with no title', () => {
    expect(confirmTargetName('   ')).toBe('Untitled');
    expect(confirmNameMatches('', '')).toBe(false);
    expect(confirmNameMatches('   ', '  ')).toBe(false);
    expect(confirmNameMatches('untitled', '')).toBe(true);
  });
});

describe('normalizeConfirmName', () => {
  it('survives non-string input', () => {
    expect(normalizeConfirmName(undefined as unknown as string)).toBe('');
  });
});
