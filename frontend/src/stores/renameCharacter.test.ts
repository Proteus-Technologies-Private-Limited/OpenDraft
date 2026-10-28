import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';

const store = () => useEditorStore.getState();

beforeEach(() => {
  useEditorStore.setState({
    characters: ['SARAH', 'BOB'],
    characterProfiles: [],
    characterRelationships: [],
    tags: [],
    selectedCharacter: null,
  });
});

describe('renameCharacter', () => {
  it('moves the profile, relationships, Cast tags and selection to the new name', () => {
    store().upsertCharacterProfile('SARAH', { description: 'A detective', voice: { ai: 'openai:nova' } });
    store().upsertCharacterRelationship({ id: 'r1', characterA: 'SARAH', characterB: 'BOB', type: 'allies', description: '', dynamic: 'Stable' });
    useEditorStore.setState({
      selectedCharacter: 'SARAH',
      tags: [
        { id: 't1', categoryId: 'cast', name: 'Sarah', text: 'SARAH', notes: '', sceneId: null, elementType: 'action', createdAt: '' },
        { id: 't2', categoryId: 'props', name: 'SARAH', text: 'SARAH', notes: '', sceneId: null, elementType: 'action', createdAt: '' },
      ],
    });

    store().renameCharacter('Sarah (V.O.)', 'Sam');

    const s = store();
    expect(s.characterProfiles.map((p) => [p.name, p.description, p.voice])).toEqual([['SAM', 'A detective', { ai: 'openai:nova' }]]);
    expect(s.characterRelationships[0]).toMatchObject({ characterA: 'SAM', characterB: 'BOB' });
    expect(s.characters).toEqual(['SAM', 'BOB']);
    expect(s.selectedCharacter).toBe('SAM');
    expect(s.tags.map((t) => t.name)).toEqual(['SAM', 'SARAH']);
  });

  it('merges into an existing character, keeping its profile and dropping self-relationships', () => {
    store().upsertCharacterProfile('SARAH', { description: 'Old', age: '30s', images: ['a', 'b'] });
    store().upsertCharacterProfile('BOB', { description: 'Kept', images: ['b', 'c'] });
    store().upsertCharacterRelationship({ id: 'r1', characterA: 'SARAH', characterB: 'BOB', type: 'allies', description: '', dynamic: 'Stable' });

    store().renameCharacter('SARAH', 'BOB');

    const s = store();
    expect(s.characterProfiles).toHaveLength(1);
    expect(s.characterProfiles[0]).toMatchObject({ name: 'BOB', description: 'Kept', age: '30s', images: ['b', 'c', 'a'] });
    expect(s.characterRelationships).toEqual([]);
    expect(s.characters).toEqual(['BOB']);
  });

  it('does nothing when the name does not change', () => {
    store().upsertCharacterProfile('SARAH', { description: 'x' });
    const before = store().characterProfiles;
    store().renameCharacter('SARAH', 'Sarah');
    expect(store().characterProfiles).toBe(before);
  });
});
