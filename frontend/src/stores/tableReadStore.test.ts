/**
 * Table Read needs the script on screen. The views that replace the script
 * hide it, so opening the panel closes them first — the Outline, Statistics
 * and the Beat Board.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';
import { useTableReadStore } from './tableReadStore';

describe('openTableRead', () => {
  beforeEach(() => {
    useEditorStore.setState({ outlineOpen: false, statisticsOpen: false, beatBoardOpen: false });
    useTableReadStore.setState({ open: false });
  });

  it('closes every view that replaces the script', () => {
    useEditorStore.setState({ outlineOpen: true, statisticsOpen: true, beatBoardOpen: true });

    useTableReadStore.getState().openTableRead();

    expect(useTableReadStore.getState().open).toBe(true);
    const editors = useEditorStore.getState();
    expect(editors.outlineOpen).toBe(false);
    expect(editors.statisticsOpen).toBe(false);
    expect(editors.beatBoardOpen).toBe(false);
  });

  it('leaves the script screen alone when it is already showing', () => {
    useTableReadStore.getState().openTableRead();

    expect(useTableReadStore.getState().open).toBe(true);
    expect(useEditorStore.getState().outlineOpen).toBe(false);
    expect(useEditorStore.getState().statisticsOpen).toBe(false);
    expect(useEditorStore.getState().beatBoardOpen).toBe(false);
  });
});
