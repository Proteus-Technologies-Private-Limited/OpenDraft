/**
 * The Sidekick record: filing, tracking and keeping tasks, custom types, and
 * reading back whatever a script holds without ever throwing.
 */
import { describe, it, expect } from 'vitest';
import {
  addCustomType, addTask, normalizeData, removeCustomType, removeTask, restoreTask,
  setTypeBehavior, setTypeHidden, suggestSubject, updateTask,
} from './data';
import { BUILT_IN_TYPES, emptyData, findType, isPending, visibleTypes, type Excerpt, type TaskSource } from './model';

const excerpt = (text: string): Excerpt => ({
  content: [{ type: 'action', content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] }],
  openStart: 0,
  openEnd: 0,
  text,
});
const source: TaskSource = { sceneHeading: 'INT. KITCHEN - NIGHT', sceneUid: 'scene-1', sceneIndex: 0, elementType: 'action' };
const at = new Date('2026-11-26T10:00:00Z');
const later = new Date('2026-11-27T10:00:00Z');

describe('default task types', () => {
  it('ships ten to track and five to keep, each with a unique id and a colour', () => {
    expect(BUILT_IN_TYPES.filter((t) => t.kind === 'track')).toHaveLength(10);
    expect(BUILT_IN_TYPES.filter((t) => t.kind === 'keep')).toHaveLength(5);
    expect(new Set(BUILT_IN_TYPES.map((t) => t.id)).size).toBe(BUILT_IN_TYPES.length);
    for (const type of BUILT_IN_TYPES) expect(type.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(BUILT_IN_TYPES.map((t) => t.id)).toEqual(expect.arrayContaining(['todo', 'hold']));
  });
});

describe('filing', () => {
  it('files a To Do as open and a Hold for Later as kept, newest first', () => {
    let data = emptyData();
    const first = addTask(data, { typeId: 'todo', excerpt: excerpt('Anna waits.'), source }, at);
    data = first.data;
    const second = addTask(data, { typeId: 'hold', excerpt: excerpt('A better line.'), source }, at);
    data = second.data;
    expect(data.tasks.map((t) => t.id)).toEqual([second.task.id, first.task.id]);
    expect(first.task.status).toBe('open');
    expect(second.task.status).toBe('kept');
    expect(first.task.subject).toBe('Anna waits.');
    expect(first.task.excerpt.content[0].content?.[0].marks).toEqual([{ type: 'bold' }]);
  });

  it('refuses a type the script does not have', () => {
    expect(() => addTask(emptyData(), { typeId: 'nope', excerpt: excerpt('x'), source })).toThrow(/no task type/);
  });

  it('suggests a short subject from the first line', () => {
    expect(suggestSubject(excerpt('\n\n  First line  \nsecond'), 'To Do')).toBe('First line');
    expect(suggestSubject(excerpt('x'.repeat(100)), 'To Do')).toHaveLength(58);
    expect(suggestSubject(excerpt('   '), 'To Do')).toBe('To Do');
  });
});

describe('tracking', () => {
  it('records when a task is done and clears it when reopened', () => {
    const { data, task } = addTask(emptyData(), { typeId: 'todo', excerpt: excerpt('x'), source }, at);
    const done = updateTask(data, task.id, { status: 'done' }, later);
    expect(done.tasks[0].closedAt).toBe(later.toISOString());
    expect(isPending(done.tasks[0])).toBe(false);
    const reopened = updateTask(done, task.id, { status: 'open' }, later);
    expect(reopened.tasks[0].closedAt).toBeNull();
  });

  it('gives a task moved to the other kind a status that fits it', () => {
    const { data, task } = addTask(emptyData(), { typeId: 'todo', excerpt: excerpt('x'), source }, at);
    const moved = updateTask(updateTask(data, task.id, { status: 'in-progress' }), task.id, { typeId: 'darling' });
    expect(moved.tasks[0].status).toBe('kept');
  });

  it('puts a deleted task back where it was', () => {
    let data = emptyData();
    for (const text of ['a', 'b', 'c']) data = addTask(data, { typeId: 'todo', excerpt: excerpt(text), source }).data;
    const middle = data.tasks[1];
    const restored = restoreTask(removeTask(data, middle.id), middle, 1);
    expect(restored.tasks.map((t) => t.id)).toEqual(data.tasks.map((t) => t.id));
    expect(restoreTask(restored, middle, 0)).toBe(restored);
  });
});

describe('task types for a script', () => {
  it('adds, hides and deletes types', () => {
    const added = addCustomType(emptyData(), { label: 'Table read', kind: 'track', color: '#123456' });
    expect(visibleTypes(added.data).some((t) => t.id === added.type.id)).toBe(true);
    expect(() => addCustomType(added.data, { label: 'table READ', kind: 'keep', color: '#123456' })).toThrow(/already/);
    const hidden = setTypeHidden(added.data, 'production', true);
    expect(visibleTypes(hidden).some((t) => t.id === 'production')).toBe(false);
    expect(removeCustomType(hidden, added.type.id).customTypes).toEqual([]);
  });

  it('will not delete a type that tasks still use', () => {
    const added = addCustomType(emptyData(), { label: 'Mine', kind: 'track', color: '#123456' });
    const withTask = addTask(added.data, { typeId: added.type.id, excerpt: excerpt('x'), source }).data;
    expect(() => removeCustomType(withTask, added.type.id)).toThrow(/still use/);
  });

  it('keeps built-in overrides and custom behavior after reopening the script', () => {
    const override = setTypeBehavior(emptyData(), 'hold', { textAction: 'copy' });
    const { data, type } = addCustomType(override, { label: 'Table read', kind: 'track', color: '#123456', scriptLink: 'optional' });
    const reopened = normalizeData(JSON.parse(JSON.stringify(data)));
    expect(findType(reopened, 'hold')).toMatchObject({ textAction: 'copy', scriptLink: 'required' });
    expect(findType(reopened, type.id)).toMatchObject({ textAction: 'copy', scriptLink: 'optional' });
  });
});

describe('normalizeData', () => {
  it('reads nothing, garbage and older records without throwing', () => {
    expect(normalizeData(undefined)).toEqual(emptyData());
    expect(normalizeData('text')).toEqual(emptyData());
    const odd = normalizeData({
      tasks: [
        { id: 'a', typeId: 'todo', subject: 'ok', status: 'bogus', excerpt: { text: 'x' } },
        { id: 'a', typeId: 'todo', subject: 'duplicate id' },
        { subject: 'no id' },
        { id: 'b', typeId: 'gone-type', subject: 'orphan', status: 'kept' },
      ],
      customTypes: [{ id: 't', label: 'Mine', kind: 'keep', color: 'red; background:url(x)' }, { nope: true }],
      hiddenTypeIds: ['trim', 4],
    });
    expect(odd.tasks.map((t) => t.id)).toEqual(['a', 'b']);
    expect(odd.tasks[0].status).toBe('open');
    expect(odd.tasks[0].excerpt).toEqual({ content: [], openStart: 0, openEnd: 0, text: 'x' });
    // A task whose type is gone is kept; its status is read as a track one.
    expect(odd.tasks[1].status).toBe('open');
    expect(odd.customTypes).toHaveLength(1);
    expect(odd.customTypes[0].color).toBe('#7c8aa5');
    expect(odd.hiddenTypeIds).toEqual(['trim']);
  });

  it('keeps a full record exactly', () => {
    const { data } = addTask(emptyData(), { typeId: 'hold', excerpt: excerpt('keep me'), source }, at);
    expect(normalizeData(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });
});
