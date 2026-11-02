import { describe, expect, it } from 'vitest';
import { parseDictation } from './dictation';
describe('screenplay voice commands', () => {
  it('dictates literally unless commands are explicitly enabled', () => {
    expect(parseDictation('new scene')).toEqual({ kind: 'text', text: 'new scene' });
  });
  it.each(['NEW SCENE', 'new scene.', 'New Scene!'])('recognizes a whole command: %s', value => {
    expect(parseDictation(value, true)).toEqual({ kind: 'element', type: 'sceneHeading', text: '' });
  });
  it('creates a character cue without losing the name', () => {
    expect(parseDictation('character Sarah.', true)).toEqual({ kind: 'element', type: 'character', text: 'SARAH' });
  });
  it.each(['We need a new scene.', 'The character Sarah leaves.', 'new scene interior kitchen', 'character'])('does not treat ordinary dialogue as a command: %s', value => {
    expect(parseDictation(value, true)).toEqual({ kind: 'text', text: value });
  });
  it('has a literal escape for command words', () => {
    expect(parseDictation('literal new scene', true)).toEqual({ kind: 'text', text: 'new scene' });
  });
  it('supports paragraph and element commands', () => {
    expect(parseDictation('new paragraph', true)).toEqual({ kind: 'paragraph' });
    for (const type of ['action', 'dialogue', 'transition', 'parenthetical']) expect(parseDictation(type, true)).toEqual({ kind: 'element', type, text: '' });
  });
  it('ignores empty results', () => { expect(parseDictation('  ', true)).toBeNull(); });
});
