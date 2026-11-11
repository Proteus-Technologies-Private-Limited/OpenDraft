import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { testExtensions, block, doc as jsonDoc } from '../test/screenplaySchema';
import { noteAnchors } from './noteAnchors';

const schema = getSchema(testExtensions);
const marked = (type: string, id: string) => ({ type, content: [{ type: 'text', text: 'Anchor', marks: [{ type: 'scriptNote', attrs: { noteId: id } }] }] });

describe('shared report and editor note anchors', () => {
  it('agrees for PM and JSON documents across nonprinting and nested blocks', () => {
    const doc = schema.nodeFromJSON(jsonDoc(block('sceneHeading', 'INT. ROOM - DAY'),
      marked('section', 'section'), marked('note', 'note'), marked('titlePage', 'title'),
      { type: 'dualDialogue', content: [{ type: 'dualDialogueColumn', content: [marked('dialogue', 'nested')] }] },
      marked('action', 'section')));
    const json = noteAnchors(doc.toJSON());
    const pm = noteAnchors(doc);
    expect([...pm.keys()]).toEqual(['section', 'note', 'title', 'nested']);
    for (const [id, anchor] of pm) {
      expect(anchor.nodeIndex).toBe(json.get(id)?.nodeIndex);
      expect(doc.textBetween(anchor.position!, anchor.position! + 6)).toBe('Anchor');
    }
    expect(pm.get('section')?.nodeIndex).toBe(1);
  });
});
