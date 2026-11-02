/**
 * Sequence labels live on scene headings, not in a document attribute, so a
 * Yjs round-trip keeps them: node attributes are part of the shared fragment,
 * while top-level document attributes are not.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { getSchema, Node } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';

const sceneHeading = Node.create({
  name: 'sceneHeading',
  group: 'block',
  content: 'inline*',
  addAttributes() {
    return {
      sequenceId: { default: null },
      sequenceName: { default: null },
      sequenceColor: { default: null },
    };
  },
  parseHTML() { return [{ tag: 'div' }]; },
  renderHTML() { return ['div', 0]; },
});

const schema = getSchema([Document, Text, sceneHeading]);

describe('sequence labels and collaboration', () => {
  it('survive a Yjs round-trip on the scene heading', () => {
    const json = {
      type: 'doc',
      content: [{
        type: 'sceneHeading',
        attrs: { sequenceId: 'seq-1', sequenceName: 'Opening', sequenceColor: '#123456' },
        content: [{ type: 'text', text: 'INT. HOUSE - DAY' }],
      }],
    };

    const yDoc = prosemirrorJSONToYDoc(schema, json);
    const back = yDocToProsemirrorJSON(yDoc);
    const heading = back.content?.[0];

    expect(heading?.attrs?.sequenceId).toBe('seq-1');
    expect(heading?.attrs?.sequenceName).toBe('Opening');
    expect(heading?.attrs?.sequenceColor).toBe('#123456');
    yDoc.destroy();
  });

  it('does not rely on a document attribute for the label', () => {
    const json = {
      type: 'doc',
      attrs: { sequences: [{ id: 'seq-1', name: 'Opening' }] },
      content: [{
        type: 'sceneHeading',
        attrs: { sequenceId: 'seq-1', sequenceName: 'Opening', sequenceColor: '#123456' },
        content: [{ type: 'text', text: 'INT. HOUSE - DAY' }],
      }],
    };

    const yDoc = prosemirrorJSONToYDoc(schema, json);
    const back = yDocToProsemirrorJSON(yDoc);
    // The document-level attribute is not part of the fragment; the label on
    // the scene is, and that is what the Outline reads.
    expect(back.attrs?.sequences).toBeUndefined();
    expect(back.content?.[0]?.attrs?.sequenceName).toBe('Opening');
    yDoc.destroy();
  });
});
