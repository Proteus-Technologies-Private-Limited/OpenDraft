import { describe, it, expect } from 'vitest';
import { docHasAnyText, isDestructiveEmptyOverwrite } from './docText';

// The exact body the data-loss bug left behind: a single empty action node.
const BLANK_BODY = { type: 'doc', content: [{ type: 'action', attrs: { textAlign: null } }] };

// A realistic save payload: doc body + app metadata keys alongside it.
const FULL_DOC = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. ROOM - DAY' }] },
    { type: 'action', content: [{ type: 'text', text: 'A man sits.' }] },
  ],
};
const FULL_SAVE_PAYLOAD = {
  ...FULL_DOC,
  _notes: [],
  _tagCategories: [{ id: 'cast', name: 'Cast' }],
};
const BLANK_SAVE_PAYLOAD = { ...BLANK_BODY, _tagCategories: [{ id: 'cast', name: 'Cast' }] };

describe('docHasAnyText', () => {
  it('is false for the blanked single-empty-action body', () => {
    expect(docHasAnyText(BLANK_BODY)).toBe(false);
  });

  it('is true for a body with real text', () => {
    expect(docHasAnyText(FULL_DOC)).toBe(true);
  });

  it('ignores text in metadata keys (only walks `content`)', () => {
    // _tagCategories has a `name` string, but it is not under a `content` array,
    // so it must not count as body text.
    expect(docHasAnyText(BLANK_SAVE_PAYLOAD)).toBe(false);
    expect(docHasAnyText(FULL_SAVE_PAYLOAD)).toBe(true);
  });

  it('treats whitespace-only text as empty', () => {
    const ws = { type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: '   \n\t' }] }] };
    expect(docHasAnyText(ws)).toBe(false);
  });

  it('is false for null / undefined / non-objects', () => {
    expect(docHasAnyText(null)).toBe(false);
    expect(docHasAnyText(undefined)).toBe(false);
    expect(docHasAnyText('text')).toBe(false);
  });

  it('finds text nested deep in the tree', () => {
    const nested = { type: 'doc', content: [{ type: 'a', content: [{ type: 'b', content: [{ type: 'text', text: 'deep' }] }] }] };
    expect(docHasAnyText(nested)).toBe(true);
  });
});

describe('isDestructiveEmptyOverwrite (blank-document guard)', () => {
  it('BLOCKS overwriting a script that has text with an empty body', () => {
    expect(isDestructiveEmptyOverwrite(BLANK_SAVE_PAYLOAD, FULL_SAVE_PAYLOAD)).toBe(true);
  });

  it('ALLOWS saving real content (the normal case)', () => {
    expect(isDestructiveEmptyOverwrite(FULL_SAVE_PAYLOAD, FULL_SAVE_PAYLOAD)).toBe(false);
  });

  it('ALLOWS saving an empty body when the script was already empty (new screenplay)', () => {
    expect(isDestructiveEmptyOverwrite(BLANK_BODY, BLANK_BODY)).toBe(false);
  });

  it('ALLOWS an empty overwrite when the caller opts in via allowEmptyBody', () => {
    expect(isDestructiveEmptyOverwrite(BLANK_SAVE_PAYLOAD, FULL_SAVE_PAYLOAD, true)).toBe(false);
  });

  it('ALLOWS saves that do not include content (metadata-only update)', () => {
    expect(isDestructiveEmptyOverwrite(undefined, FULL_SAVE_PAYLOAD)).toBe(false);
  });

  it('ALLOWS overwriting an empty script with real content', () => {
    expect(isDestructiveEmptyOverwrite(FULL_SAVE_PAYLOAD, BLANK_BODY)).toBe(false);
  });
});
