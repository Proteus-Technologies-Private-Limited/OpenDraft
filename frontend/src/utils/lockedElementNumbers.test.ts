import { describe, it, expect } from 'vitest';
import {
  assignElementNumbers,
  withElementNumbers,
  collectJSON,
  type NumberingItem,
  type NumberingRules,
} from './elementNumbers';
const rules: NumberingRules = { dialogue: { enabled: true, resetOn: [] } };
const items = (...numbers: Array<string | null>): NumberingItem[] =>
  numbers.map((number) => ({
    elementId: 'dialogue',
    empty: false,
    number,
    numberLocked: !!number,
  }));
describe('stable element references', () => {
  it('keeps originals and gives inserted lines suffixes', () =>
    expect(
      assignElementNumbers(items('12', null, null, '13'), rules, {
        sceneNumbersVisible: true,
      }),
    ).toEqual(['12', '12A', '12B', '13']));
  it('allocates an insert between existing suffixes without moving either', () =>
    expect(
      assignElementNumbers(items('12A', null, '12B'), rules, {
        sceneNumbersVisible: true,
      }),
    ).toEqual(['12A', '12AA', '12B']));
  it('retains prefixes and numbers inserted before the first reference', () =>
    expect(
      assignElementNumbers(items(null, 'FX 12', 'FX 13'), rules, {
        sceneNumbersVisible: true,
      }),
    ).toEqual(['FX A12', 'FX 12', 'FX 13']));
  it('preserves imported references without a local numbering template', () =>
    expect(
      assignElementNumbers(items('9', null, '10'), {}, { sceneNumbersVisible: false }),
    ).toEqual(['9', null, '10']));
  it('keeps reset scopes and shared counters independent', () => {
    const source = [
      ...items('1', null, '2'),
      { elementId: 'sceneHeading', empty: false },
      ...items('1', null, '2'),
    ];
    expect(
      assignElementNumbers(
        source,
        { dialogue: { enabled: true, resetOn: ['sceneHeading'] } },
        { sceneNumbersVisible: true },
      ),
    ).toEqual(['1', '1A', '2', null, '1', '1A', '2']);
  });
  it('keeps a manual override without enabling numbering on every other element', () => {
    const source = items(null, 'SPECIAL', null).map((i) => ({
      ...i,
      numberLocked: false,
    }));
    expect(assignElementNumbers(source, {}, { sceneNumbersVisible: true })).toEqual([
      null,
      'SPECIAL',
      null,
    ]);
  });
  it('hides an export without erasing stored references in the document', () => {
    const source = {
      type: 'doc',
      content: [
        {
          type: 'dialogue',
          attrs: { elementNumber: '12', elementNumberLocked: true },
          content: [{ type: 'text', text: 'Speech' }],
        },
      ],
    };
    const exported = withElementNumbers(source, {
      visible: false,
      sceneNumbersVisible: false,
      rules,
    });
    expect(exported.content![0].attrs?.elementNumber).toBeNull();
    expect(source.content[0].attrs.elementNumber).toBe('12');
    expect(collectJSON(source)[0].item.number).toBe('12');
  });
});

it('exports a stored inline reference as text without also leaving a margin number', () => {
  const source = {
    type: 'doc',
    content: [
      {
        type: 'dialogue',
        attrs: { elementNumber: '12B', elementNumberLocked: true },
        content: [{ type: 'text', text: 'Words' }],
      },
    ],
  };
  const exported = withElementNumbers(source, {
    visible: true,
    sceneNumbersVisible: false,
    inlineAsText: true,
    rules: { dialogue: { enabled: true, resetOn: [], placement: 'inline' } },
  });
  expect(exported.content![0].attrs?.elementNumber).toBeNull();
  expect(exported.content![0].content![0].text).toBe('12B Words');
});

it('prefixes the following reference when inserting between a parent and its first suffix', () => {
  expect(assignElementNumbers(items('1', null, '1A'), rules, { sceneNumbersVisible: true })).toEqual(['1', 'A1A', '1A']);
  expect(assignElementNumbers(items('1', null, null, '1A'), rules, { sceneNumbersVisible: true })).toEqual(['1', 'A1A', 'A1B', '1A']);
  expect(assignElementNumbers(items('1A', null, '1AA'), rules, { sceneNumbersVisible: true })).toEqual(['1A', 'A1AA', '1AA']);
});

it('keeps suffix rollover and existing intermediate suffixes intact', () => {
  expect(assignElementNumbers(items('1Z', null, '2'), rules, { sceneNumbersVisible: true })).toEqual(['1Z', '1AA', '2']);
  expect(assignElementNumbers(items('2A', null, '2B'), rules, { sceneNumbersVisible: true })).toEqual(['2A', '2AA', '2B']);
});

it('keeps repeated insertions before an existing prefix insertion', () => {
  for (const [previous, following, expected] of [
    ['1', 'A1A', 'AA1A'],
    ['1', 'AA1A', 'AAA1A'],
    ['1A', 'A1AA', 'AA1AA'],
    ['FX 1', 'FX A1A', 'FX AA1A'],
  ]) {
    expect(
      assignElementNumbers(items(previous, null, following), rules, { sceneNumbersVisible: false }),
    ).toEqual([previous, expected, following]);
  }
});

it('renumbers automatic imported references after insertion and deletion, retaining sparse display without a format', () => {
  const imported = items('1', '2', '3').map((item) => ({
    ...item,
    numberLocked: false,
    numberAutomatic: true,
  }));
  const inserted = [imported[0], ...items(null), ...imported.slice(1)];
  expect(assignElementNumbers(inserted, rules, { sceneNumbersVisible: false })).toEqual([
    '1',
    '2',
    '3',
    '4',
  ]);
  expect(
    assignElementNumbers([imported[0], imported[2]], rules, { sceneNumbersVisible: false }),
  ).toEqual(['1', '2']);
  expect(assignElementNumbers(imported, {}, { sceneNumbersVisible: false })).toEqual([
    '1',
    '2',
    '3',
  ]);
  expect(
    assignElementNumbers([{ ...imported[0], number: '3' }, ...items(null, null)], rules, {
      sceneNumbersVisible: false,
    }),
  ).toEqual(['1', '2', '3']);
});

it('does not allocate automatic labels already held by legacy or manual references', () => {
  const legacy = items('1', null, '2', '3').map((item) => ({ ...item, numberLocked: false }));
  const labels = assignElementNumbers(legacy, rules, { sceneNumbersVisible: false });
  expect(labels).toEqual(['1', '4', '2', '3']);
  expect(new Set(labels).size).toBe(labels.length);
  expect(
    assignElementNumbers(
      items('3', null, null).map((item) => ({ ...item, numberLocked: false })),
      rules,
      { sceneNumbersVisible: false },
    ),
  ).toEqual(['3', '2', '4']);
});

it('suppresses an automatic imported label on an empty paragraph only in a numbered export copy', () => {
  const source = {
    type: 'doc',
    content: [{ type: 'dialogue', attrs: { elementNumber: '3', elementNumberAutomatic: true } }],
  };
  const exported = withElementNumbers(source, { visible: true, sceneNumbersVisible: false, rules });
  expect(exported.content![0].attrs?.elementNumber).toBeNull();
  expect(source.content[0].attrs.elementNumber).toBe('3');
  expect(
    withElementNumbers(source, { visible: true, sceneNumbersVisible: false, rules: {} }).content![0]
      .attrs?.elementNumber,
  ).toBe('3');
});
