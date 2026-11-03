/**
 * Sequence labels travel on the scene headings, so collaboration syncs them;
 * a document-level list is still read as a fallback for older scripts.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import { computeScriptStructure } from './scriptStructure';

const heading = (text: string, attrs: Record<string, unknown> = {}): JSONContent => ({
  type: 'sceneHeading',
  attrs,
  content: [{ type: 'text', text }],
});

const action = (text: string): JSONContent => ({
  type: 'action',
  content: [{ type: 'text', text }],
});

const doc = (content: JSONContent[]): JSONContent => ({
  type: 'doc',
  content,
});

describe('computeScriptStructure sequences', () => {
  it('reads the label from the scene headings, in script order', () => {
    const structure = computeScriptStructure(doc([
      heading('INT. A - DAY', { sequenceId: 's1', sequenceName: 'Opening', sequenceColor: '#111111' }),
      action('One.'),
      heading('INT. B - DAY', { sequenceId: 's2', sequenceName: 'Middle', sequenceColor: '#222222' }),
      heading('INT. C - DAY', { sequenceId: 's1', sequenceName: 'Opening', sequenceColor: '#111111' }),
    ]));

    expect(structure.acts[0].scenes.map((scene) => scene.heading)).toEqual([
      'INT. A - DAY', 'INT. B - DAY', 'INT. C - DAY',
    ]);
    const opening = structure.acts[0].sequences.find((sequence) => sequence.id === 's1');
    expect(opening?.name).toBe('Opening');
    expect(opening?.color).toBe('#111111');
    expect(opening?.scenes.map((scene) => scene.sceneIndex)).toEqual([0, 2]);
  });

  it('keeps scenes of a sequence inside the act they belong to', () => {
    const structure = computeScriptStructure(doc([
      heading('INT. A - DAY', { sequenceId: 's1', sequenceName: 'Opening' }),
      { type: 'newAct', attrs: { actNumber: 1 } },
      heading('INT. B - DAY', { sequenceId: 's1', sequenceName: 'Opening' }),
    ]));

    const acts = structure.acts.filter((act) => act.actNumber > 0);
    expect(acts).toHaveLength(1);
    expect(acts[0].sequences[0].scenes.map((scene) => scene.heading)).toEqual(['INT. B - DAY']);
  });
});
