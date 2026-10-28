import { describe, it, expect } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import {
  BUILT_IN_REPORTS, collectReportScenes, cueName, formatEighths, reportToCsv, type ReportInput,
} from './scriptReports';
import { DEFAULT_TIMING_OPTIONS } from './scriptTiming';
import type { CharacterProfile, TagCategory, TagItem } from '../stores/editorStore';

const el = (type: string, text: string, attrs?: Record<string, unknown>, marks?: JSONContent['marks']): JSONContent => ({
  type, content: [{ type: 'text', text, ...(marks ? { marks } : {}) }], ...(attrs ? { attrs } : {}),
});
const tagged = (tagId: string) => [{ type: 'productionTag', attrs: { tagId, categoryId: 'props' } }];

const doc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'titlePage', attrs: { field: 'title', tpTitle: 'X' } },
    el('sceneHeading', 'INT. KITCHEN - NIGHT', { sceneNumber: '1' }),
    el('action', 'Maya grips the knife.', undefined, tagged('t-knife')),
    el('character', 'MAYA'),
    el('dialogue', 'You came back.'),
    el('character', "DEV (CONT'D)"),
    el('parenthetical', '(quietly)'),
    el('dialogue', 'I never left.'),
    el('sceneHeading', 'EXT. ROOF - DAY', { sceneNumber: '2' }),
    {
      type: 'dualDialogue',
      content: [
        { type: 'dualDialogueColumn', content: [el('character', 'MAYA'), el('dialogue', 'Now.')] },
        { type: 'dualDialogueColumn', content: [el('character', 'SAM (O.S.)'), el('dialogue', 'Not yet.')] },
      ],
    },
    el('sceneHeading', 'INT. KITCHEN - LATER', { sceneNumber: '2A' }),
    el('action', 'The knife is gone.', undefined, tagged('t-knife')),
  ],
};

const profiles = [
  { name: 'MAYA', role: 'Lead', gender: 'Female', age: '34', description: '<p>A cook &amp; a liar.</p>' },
] as unknown as CharacterProfile[];
const tags = [
  { id: 't-knife', categoryId: 'props', name: 'Kitchen knife', text: 'knife', notes: 'Rubber for stunts', sceneId: null, elementType: 'action', createdAt: '' },
] as TagItem[];
const categories: TagCategory[] = [{ id: 'props', name: 'Props', color: '#000', isBuiltIn: true }];

const input: ReportInput = { doc, characterProfiles: profiles, tags, tagCategories: categories, timing: DEFAULT_TIMING_OPTIONS };
const report = (id: string) => BUILT_IN_REPORTS.find((r) => r.id === id)!.build(input);

describe('collecting scenes', () => {
  const scenes = collectReportScenes(doc, DEFAULT_TIMING_OPTIONS);

  it('reads numbers, locations and speakers, dual dialogue included', () => {
    expect(scenes.map((s) => s.number)).toEqual(['1', '2', '2A']);
    expect(scenes.map((s) => s.location)).toEqual(['KITCHEN', 'ROOF', 'KITCHEN']);
    expect(scenes[0].speakers).toEqual(['MAYA', 'DEV']);
    expect(scenes[1].speakers).toEqual(['MAYA', 'SAM']);
    expect(scenes[0].dialogue.get('DEV')).toEqual({ speeches: 1, words: 3 });
  });

  it('finds the tags marked in each scene', () => {
    expect(scenes.map((s) => s.tagIds.has('t-knife'))).toEqual([true, false, true]);
  });

  it('measures every scene as at least an eighth of a page', () => {
    for (const s of scenes) expect(s.eighths).toBeGreaterThanOrEqual(1);
  });
});

describe('the built-in reports', () => {
  it('scene report: one row per scene', () => {
    const t = report('scenes');
    expect(t.rows.map((r) => r[0])).toEqual(['1', '2', '2A']);
    expect(t.rows[0][7]).toBe('MAYA, DEV');
  });

  it('character report: totals across scenes, most words first', () => {
    const t = report('characters');
    const maya = t.rows.find((r) => r[0] === 'MAYA')!;
    expect(maya.slice(0, 5)).toEqual(['MAYA', 'Lead', 'Female', 2, 4]);
    expect(maya[7]).toBe('1, 2');
    expect(t.rows[0][0]).toBe('MAYA');
  });

  it('location report: a location used twice is one row', () => {
    const t = report('locations');
    const kitchen = t.rows.find((r) => r[0] === 'KITCHEN')!;
    expect(kitchen[1]).toBe('INT.');
    expect(kitchen[3]).toBe(2);
    expect(kitchen[5]).toBe('1, 2A');
  });

  it('cast report: profile text without its HTML', () => {
    const t = report('cast');
    expect(t.rows.find((r) => r[0] === 'MAYA')).toEqual(['MAYA', 'Lead', 'Female', '34', 2, 'A cook & a liar.']);
  });

  it('breakdown report: each tagged item with its scenes', () => {
    expect(report('breakdown').rows).toEqual([['Props', 'Kitchen knife', 2, '1, 2A', 'Rubber for stunts']]);
  });
});

describe('formatting', () => {
  it('writes page lengths in eighths', () => {
    expect(formatEighths(3)).toBe('3/8');
    expect(formatEighths(8)).toBe('1');
    expect(formatEighths(11)).toBe('1 3/8');
  });

  it('reads cues without their extensions', () => {
    expect(cueName("maya (v.o.) (cont'd)")).toBe('MAYA');
    expect(cueName('DR. SMITH (O.S.)')).toBe('DR. SMITH');
  });

  it('writes CSV a spreadsheet opens safely', () => {
    const csv = reportToCsv({ title: 'T', columns: ['Name', 'Note'], rows: [['=HYPERLINK("x")', 'a, "b"\nc'], ['Zoë', 3]] });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe('\uFEFFName,Note\r\n"\'=HYPERLINK(""x"")","a, ""b""\nc"\r\nZoë,3\r\n');
  });
});

describe('notes reports', () => {
  const noted = (id: string) => [{ type: 'scriptNote', attrs: { noteId: id, color: '#f4d35e' } }];
  const notesDoc: JSONContent = {
    type: 'doc',
    content: [
      el('sceneHeading', 'INT. KITCHEN - NIGHT', { sceneNumber: '1' }),
      el('action', 'Maya grips the knife.', undefined, noted('late')),
      el('sceneHeading', 'EXT. ROOF - DAY', { sceneNumber: '2' }),
      {
        type: 'dualDialogue',
        content: [{ type: 'dualDialogueColumn', content: [el('character', 'MAYA'), el('dialogue', 'Now.', undefined, noted('dual'))] }],
      },
    ],
  };
  const base = { elementType: 'action', contextLabel: '', color: 'Yellow' as const, sceneId: null, createdAt: '2026-10-01T09:00:00.000Z' };
  const notes = [
    // Stored newest first; the report lists them in script order.
    { ...base, id: 'dual', content: 'Overlap? @ana_ruiz', anchorText: 'Now.', author: 'Ana', assignee: 'Ben' },
    {
      ...base, id: 'late', content: 'Cut this', anchorText: 'Maya grips', author: 'Ben',
      resolved: true, resolvedBy: 'Ana', resolvedAt: '2026-10-03T00:00:00.000Z',
      replies: [{ id: 'r1', author: 'Ana Ruiz', content: 'Done, @Ben.', createdAt: '2026-10-02T00:00:00.000Z' }],
    },
    { ...base, id: 'gone', content: 'Highlight was deleted', anchorText: 'old text' },
  ];
  const generalNotes = [{ id: 'g', title: 'Tone', content: 'Darker', color: 'Blue' as const, createdAt: '2026-10-04T00:00:00.000Z' }];
  const notesInput: ReportInput = { ...input, doc: notesDoc, notes, generalNotes };
  const build = (id: string) => BUILT_IN_REPORTS.find((r) => r.id === id)!.build(notesInput);

  it('lists notes in script order with their scene, replies under them, then general and stray notes', () => {
    const t = build('notes');
    expect(t.rows.map((r) => [r[0], r[1], r[2], r[3], r[4]])).toEqual([
      ['1', '1', 'Maya grips', 'Ben', 'Cut this'],
      ['1.1', '', '', 'Ana Ruiz', 'Done, @Ben.'],
      ['2', '2', 'Now.', 'Ana', 'Overlap? @Ana Ruiz'],
      ['3', 'General', 'Tone', '', 'Darker'],
      ['4', '', 'old text', '', 'Highlight was deleted'],
    ]);
    expect(t.rows[0][5]).toBe('Resolved by Ana 2026-10-03');
    expect(t.rows[2].slice(5)).toEqual(['Open', 'Ben', '2026-10-01']);
    expect(t.summary).toBe('4 notes · 3 open · 1 resolved · 1 reply');
  });

  it('leaves resolved notes and their replies out of Open Notes', () => {
    const t = build('open-notes');
    expect(t.rows.map((r) => r[4])).toEqual(['Overlap? @Ana Ruiz', 'Darker', 'Highlight was deleted']);
    expect(t.rows.map((r) => r[0])).toEqual(['1', '2', '3']);
    expect(t.summary).toBe('3 open notes · 0 replies');
  });

  it('reports nothing for a script without notes', () => {
    expect(BUILT_IN_REPORTS.find((r) => r.id === 'notes')!.build(input).rows).toEqual([]);
  });
});
