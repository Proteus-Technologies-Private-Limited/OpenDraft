import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_PANELS,
  NAVIGATOR_PANELS,
  WORKSPACE_PRESET_IDS,
  dockOfGroup,
  groupOfPanel,
  hidePanel,
  layoutPanels,
  mergeGroups,
  moveGroup,
  movePanelToGroup,
  movePanelToNewGroup,
  normaliseSavedWorkspaceLayouts,
  normaliseWorkspaceLayout,
  placeOfPanel,
  renameGroup,
  sameWorkspaceLayout,
  setGroupMode,
  shiftPanelInGroup,
  ungroup,
  workspacePreset,
} from './workspaceLayout';

const sorted = (list: string[]) => [...list].sort();

describe('workspace layout', () => {
  it('places every built-in panel exactly once in every preset', () => {
    for (const id of WORKSPACE_PRESET_IDS) {
      const layout = workspacePreset(id);
      expect(sorted(layoutPanels(layout))).toEqual(sorted(BUILT_IN_PANELS));
    }
  });

  it('keeps Classic as the editor has always been', () => {
    const classic = workspacePreset('classic');
    const nav = groupOfPanel(classic, 'scenes')!;
    expect(classic.groups[nav].panels).toEqual([...NAVIGATOR_PANELS]);
    expect(dockOfGroup(classic, nav)).toBe('start');
    expect(placeOfPanel(classic, 'notes')).toBe('end');
    expect(placeOfPanel(classic, 'table-read')).toBe('bottom');
    expect(classic.arrange.end).toBe('columns');
  });

  it('moves the whole Navigator with its group', () => {
    const classic = workspacePreset('classic');
    const nav = groupOfPanel(classic, 'scenes')!;
    const moved = moveGroup(classic, nav, 'end', null);
    for (const panel of NAVIGATOR_PANELS) expect(placeOfPanel(moved, panel)).toBe('end');
    expect(classic.docks.start).toEqual([nav]); // the original is untouched
  });

  it('moves one Navigator panel on its own', () => {
    const classic = workspacePreset('classic');
    const next = movePanelToNewGroup(classic, 'bookmarks', 'end');
    expect(placeOfPanel(next, 'bookmarks')).toBe('end');
    expect(placeOfPanel(next, 'scenes')).toBe('start');
    expect(next.groups[groupOfPanel(next, 'scenes')!].panels).not.toContain('bookmarks');
  });

  it('adds a panel to another group as a tab, and drops a group left empty', () => {
    const classic = workspacePreset('classic');
    const notesGroup = groupOfPanel(classic, 'notes')!;
    const next = movePanelToGroup(classic, 'characters', notesGroup);
    expect(next.groups[notesGroup].panels).toEqual(['notes', 'characters']);
    expect(Object.values(next.groups).some((g) => g.panels.length === 0)).toBe(false);
    expect(next.docks.end).not.toContain('g-characters');
  });

  it('starts a new group before another when dropped on its header', () => {
    const classic = workspacePreset('classic');
    const next = movePanelToNewGroup(classic, 'pages', 'end', 'g-notes');
    const index = next.docks.end.indexOf(groupOfPanel(next, 'pages')!);
    expect(next.docks.end[index + 1]).toBe('g-notes');
  });

  it('merges, ungroups, renames, reorders and stacks', () => {
    let layout = workspacePreset('classic');
    layout = mergeGroups(layout, 'g-tags', 'g-notes');
    expect(layout.groups['g-notes'].panels).toEqual(['notes', 'tags']);
    expect(layout.groups['g-tags']).toBeUndefined();
    layout = shiftPanelInGroup(layout, 'tags', -1);
    expect(layout.groups['g-notes'].panels).toEqual(['tags', 'notes']);
    layout = setGroupMode(layout, 'g-notes', 'stacked');
    expect(layout.groups['g-notes'].mode).toBe('stacked');
    layout = renameGroup(layout, 'g-notes', '  Review ');
    expect(layout.groups['g-notes'].name).toBe('Review');
    layout = ungroup(layout, 'g-notes');
    expect(layout.groups['g-notes'].panels).toEqual(['tags']);
    expect(placeOfPanel(layout, 'notes')).toBe('end');
  });

  it('leaves panels out, and hides a whole group', () => {
    const classic = workspacePreset('classic');
    const hidden = hidePanel(classic, 'tuner');
    expect(placeOfPanel(hidden, 'tuner')).toBe('hidden');
    const nav = groupOfPanel(classic, 'scenes')!;
    const noNav = moveGroup(classic, nav, 'hidden');
    for (const panel of NAVIGATOR_PANELS) expect(placeOfPanel(noNav, panel)).toBe('hidden');
    // and back again
    const back = movePanelToNewGroup(noNav, 'scenes', 'start');
    expect(placeOfPanel(back, 'scenes')).toBe('start');
  });

  it('normalises: drops unknowns and duplicates, and gives a missing panel its Classic place', () => {
    const layout = normaliseWorkspaceLayout({
      groups: {
        a: { panels: ['scenes', 'nope', 'scenes'], mode: 'tabs' },
        b: { panels: ['notes'], mode: 'stacked', name: 'Mine' },
        empty: { panels: [] },
      },
      docks: { start: ['a', 'empty'], end: ['b', 'a'], bottom: [] },
      hidden: ['tags', 'notes'],
      arrange: { start: 'columns', end: 'bogus' },
    });
    expect(layout.groups.a.panels.filter((p) => p === 'scenes')).toHaveLength(1);
    expect(layout.docks.start).toContain('a');
    expect(layout.docks.end).toContain('b');
    expect(layout.groups.b).toMatchObject({ mode: 'stacked', name: 'Mine' });
    expect(layout.hidden).toEqual(['tags']);
    expect(layout.arrange.start).toBe('columns');
    expect(sorted(layoutPanels(layout))).toEqual(sorted(BUILT_IN_PANELS));
    // The other Navigator panels rejoin the group that holds Scenes.
    expect(layout.groups.a.panels).toEqual(expect.arrayContaining(['pages', 'locations', 'structure', 'bookmarks']));
  });

  it('falls back to Classic for garbage, and keeps plugin panels', () => {
    expect(sameWorkspaceLayout(normaliseWorkspaceLayout(null), workspacePreset('classic'))).toBe(true);
    const layout = normaliseWorkspaceLayout({ groups: { p: { panels: ['plugin:acme'] } }, docks: { bottom: ['p'] } });
    expect(placeOfPanel(layout, 'plugin:acme')).toBe('bottom');
  });

  it('reads saved layouts and refuses a preset id', () => {
    const saved = normaliseSavedWorkspaceLayouts([
      { id: 'mine', label: ' Rewrite ', layout: workspacePreset('split') },
      { id: 'classic', label: 'Clash', layout: {} },
      { id: 'mine', label: 'Again' },
    ]);
    expect(saved.map((s) => [s.id, s.label])).toEqual([['mine', 'Rewrite']]);
    expect(sameWorkspaceLayout(saved[0].layout, workspacePreset('split'))).toBe(true);
  });
});
