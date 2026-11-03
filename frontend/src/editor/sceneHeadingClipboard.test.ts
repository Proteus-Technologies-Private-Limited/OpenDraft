/**
 * Copying a scene heading has to keep its sequence label: the Outline groups
 * scenes by the id, and the name and colour are what the writer sees in it.
 * The clipboard is HTML, so the attributes the node writes are the ones a
 * paste reads back.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import { SceneHeading } from './extensions/SceneHeading';

const schema = getSchema([Document.extend({ content: 'block+' }), Text, SceneHeading]);
const heading = schema.nodes.sceneHeading;

/** The attributes the node writes to the DOM, i.e. what a copy puts on the clipboard. */
function copiedAttributes(attrs: Record<string, unknown>): Record<string, string> {
  const node = heading.create(attrs, schema.text('INT. HOUSE - DAY'));
  const spec = heading.spec.toDOM!(node) as [string, Record<string, string>, ...unknown[]];
  return spec[1];
}

/** What the editor reads from that HTML when the heading is pasted. */
function pastedAttributes(attributes: Record<string, string>): Record<string, unknown> {
  const element = {
    getAttribute: (name: string) => attributes[name] ?? null,
  } as unknown as HTMLElement;
  const rule = heading.spec.parseDOM!.find((r) => r.tag === 'div[data-type="scene-heading"]')!;
  return rule.getAttrs!(element) as Record<string, unknown>;
}

describe('copying a scene heading', () => {
  it('keeps the sequence label when the heading is pasted', () => {
    const copied = copiedAttributes({
      sequenceId: 'seq-1', sequenceName: 'The Heist', sequenceColor: '#123456',
    });
    expect(copied['data-sequence-id']).toBe('seq-1');

    const pasted = pastedAttributes(copied);
    expect(pasted.sequenceId).toBe('seq-1');
    expect(pasted.sequenceName).toBe('The Heist');
    expect(pasted.sequenceColor).toBe('#123456');
  });

  it('drops a sequence colour that is not a hex value', () => {
    const copied = copiedAttributes({
      sequenceId: 'seq-1', sequenceColor: 'url(https://example.com/x.png)',
    });
    expect(copied['data-sequence-id']).toBe('seq-1');
    expect(copied['data-sequence-color']).toBeUndefined();

    const pasted = pastedAttributes({
      'data-sequence-id': 'seq-1',
      'data-sequence-color': 'url(https://example.com/x.png)',
    });
    expect(pasted.sequenceId).toBe('seq-1');
    expect(pasted.sequenceColor).toBeNull();
  });

  it('writes no sequence attributes for a scene in no sequence', () => {
    const copied = copiedAttributes({});
    expect(copied['data-sequence-id']).toBeUndefined();
    expect(copied['data-sequence-name']).toBeUndefined();
    expect(copied['data-sequence-color']).toBeUndefined();
  });
});
