import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { reviewServerSupportsFormatting, reviewAuthToken, hasPendingFormat, reviewCapability, REVIEW_PROTOCOL } from './reviewProtocol';
import { ReviewGate, supportsReview, hasReviewFormats } from '../../../collab-server/src/services/reviewProtocol';
import type { YjsLike } from '../../../collab-server/src/services/suggestionGuard';
const reviewY = Y as unknown as YjsLike;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function script() {
  const doc = new Y.Doc();
  const action = new Y.XmlElement('action');
  const text = new Y.XmlText();
  text.insert(0, 'Keep every word.');
  action.insert(0, [text]);
  doc.getXmlFragment('default').insert(0, [action]);
  return doc;
}
function formatUpdate(doc: Y.Doc) {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  const vector = Y.encodeStateVector(peer);
  const text = (peer.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText;
  text.format(0, 4, { suggestionFormat: { id: 'f', by: 'Ann', at: 1, format: 'bold', before: false, after: true } });
  const update = Y.encodeStateAsUpdate(peer, vector);
  peer.destroy();
  return update;
}
describe('mixed-version review compatibility', () => {
  it('keeps invites readable by old servers', () => {
    for (const token of ['my-invite', 'jwt:access|invite:my-invite']) {
      const wire = reviewAuthToken(token);
      expect(supportsReview(wire)).toBe(true);
      expect(wire.split('|').find((p) => p.startsWith('invite:'))).toBe('invite:my-invite');
    }
    expect(supportsReview('my-invite')).toBe(false);
    expect(supportsReview('invite:my-invite|review:999')).toBe(false);
  });
  it('recognizes pending format reviews before seeding legacy servers', () => {
    expect(hasPendingFormat({ type: 'doc', content: [{ type: 'text', text: 'Words', marks: [{ type: 'suggestionFormat', attrs: {} }] }] })).toBe(true);
    expect(hasPendingFormat({ type: 'doc', content: [{ type: 'text', text: 'Words', marks: [{ type: 'bold' }] }] })).toBe(false);
  });
  it('enables formatting only when the initial capability check succeeds', async () => {
    const fetcher = vi.fn(async () => response({ service: 'opendraft-collab', reviewProtocol: REVIEW_PROTOCOL }));
    expect(await reviewServerSupportsFormatting('wss://example.test/collab/', fetcher)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith('https://example.test/collab/health', { cache: 'no-store' });
    for (const unavailable of [
      async () => response({ service: 'opendraft-collab' }),
      async () => response({ service: 'opendraft-collab', reviewProtocol: 999 }),
      async () => response({}, 429),
      async () => new Response('not JSON'),
      async () => { throw new Error('Offline'); },
    ]) expect(await reviewServerSupportsFormatting('ws://example.test', unavailable)).toBe(false);
  });
  it('degrades a timed-out health check to text collaboration', async () => {
    vi.useFakeTimers();
    try {
      const probe = reviewServerSupportsFormatting('ws://example.test', () => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(10000);
      expect(await probe).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('allows legacy roles on plain scripts and refuses formats during their connection', () => {
    for (const role of ['host', 'editor', 'viewer', 'suggester']) {
      const gate = new ReviewGate();
      const doc = script();
      gate.join('room', role, false);
      expect(() => gate.checkClient(reviewY, doc, false)).not.toThrow();
      const update = formatUpdate(doc);
      expect(() => gate.checkUpdate(reviewY, 'room', doc, update, true)).toThrow();
      expect(hasReviewFormats(reviewY, doc)).toBe(false);
      gate.leave('room', role);
      expect(() => gate.checkUpdate(reviewY, 'room', doc, update, true)).not.toThrow();
      Y.applyUpdate(doc, update);
      expect(() => gate.checkClient(reviewY, doc, false)).toThrow();
      expect(() => gate.checkClient(reviewY, doc, true)).not.toThrow();
      expect(((doc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText).toDelta().map((op: { insert: unknown }) => op.insert).join('')).toBe('Keep every word.');
      doc.destroy();
    }
  });
  it('refuses format marks from a legacy connection without mutating the room', () => {
    const doc = script();
    expect(() => new ReviewGate().checkUpdate(reviewY, 'room', doc, formatUpdate(doc), false)).toThrow();
    expect(hasReviewFormats(reviewY, doc)).toBe(false);
    doc.destroy();
  });
});

it('scans only new structs, not full document clones or previously integrated history', () => {
  const doc = script(); const gate = new ReviewGate();
  const undo = new Y.UndoManager(doc.getXmlFragment('default'), { captureTimeout: 0 });
  const text = (doc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText;
  text.format(0, 4, { suggestionFormat: { id: 'f' } });
  text.format(0, 4, { suggestionFormat: null });
  gate.join('room', 'old', false);
  const module = { ...reviewY, Doc: vi.fn(() => { throw new Error('No trial document'); }), encodeStateAsUpdate: vi.fn(() => { throw new Error('No full snapshot'); }) } as unknown as YjsLike;
  expect(() => gate.checkUpdate(module, 'room', doc, Y.encodeStateAsUpdate(doc), true)).not.toThrow();
  const peer = new Y.Doc(); Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  const vector = Y.encodeStateVector(peer);
  ((peer.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'More ');
  expect(() => gate.checkUpdate(module, 'room', doc, Y.encodeStateAsUpdate(peer, vector), true)).not.toThrow();
  expect(module.Doc).not.toHaveBeenCalled(); expect(module.encodeStateAsUpdate).not.toHaveBeenCalled();
  undo.destroy(); doc.destroy(); peer.destroy();
});
it('allows a full upload whose historical proposals are deleted in the same update', () => {
  const source = script(); const undo = new Y.UndoManager(source.getXmlFragment('default'));
  const text = (source.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText;
  text.format(0, 4, { suggestionFormat: { id: 'f' } });
  text.format(0, 4, { suggestionFormat: null });
  const room = new Y.Doc(); const gate = new ReviewGate(); gate.join('room', 'old', false);
  expect(() => gate.checkUpdate(reviewY, 'room', room, Y.encodeStateAsUpdate(source), true)).not.toThrow();
  undo.destroy(); source.destroy(); room.destroy();
});
it('rejects pending format structs even when their parent dependencies have not arrived', () => {
  const source = script(); const vector = Y.encodeStateVector(source);
  const text = (source.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText;
  text.format(0, 4, { 'suggestionFormat--f': { id: 'f' } });
  const room = new Y.Doc(); const gate = new ReviewGate(); gate.join('room', 'old', false);
  expect(() => gate.checkUpdate(reviewY, 'room', room, Y.encodeStateAsUpdate(source, vector), true)).toThrow(/Update OpenDraft/);
  source.destroy(); room.destroy();
});
it('recovers formatting capability from server messages after a failed probe', async () => {
  let allowed = await reviewServerSupportsFormatting('ws://example.test', async () => response({}, 429));
  expect(allowed).toBe(false);
  for (const enabled of [true, false, true]) {
    const advertised = reviewCapability(JSON.stringify({ type: 'review-capability', enabled }));
    if (advertised !== null) allowed = advertised;
    expect(allowed).toBe(enabled);
  }
  for (const payload of ['not JSON', 'null', '{"type":"other","enabled":true}', '{"type":"review-capability","enabled":"true"}']) expect(reviewCapability(payload)).toBeNull();
});

it('refuses legacy joins while buffered proposals await parent dependencies', () => {
  const source = script();
  const base = Y.encodeStateAsUpdate(source);
  const update = formatUpdate(source);
  const room = new Y.Doc();
  Y.applyUpdate(room, update);
  expect(room.getXmlFragment('default').length).toBe(0);
  expect(hasReviewFormats(reviewY, room)).toBe(true);
  expect(() => new ReviewGate().checkClient(reviewY, room, false)).toThrow(/Update OpenDraft/);
  Y.applyUpdate(room, base);
  expect(hasReviewFormats(reviewY, room)).toBe(true);
  source.destroy(); room.destroy();
});
