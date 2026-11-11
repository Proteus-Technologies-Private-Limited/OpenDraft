import { describe, expect, it } from 'vitest';
import { getSchema, type JSONContent } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { testExtensions, block, doc as jsonDoc } from '../test/screenplaySchema';
import { ElementNumbers } from '../editor/extensions/ElementNumbers';
import { analyzeScriptHealth, healthOptionsForFormat, type HealthOptions } from './scriptHealth';
import { INDUSTRY_STANDARD_TEMPLATE } from '../stores/industryStandardTemplate';

const schema = getSchema([...testExtensions, ElementNumbers]);
const document = (...nodes: JSONContent[]) => schema.nodeFromJSON(jsonDoc(...nodes));
const defaults: HealthOptions = { numbering: {}, sceneNumbersVisible: true, dialogueChecks: true, notes: [] };
const checks = (nodes: JSONContent[], options: Partial<HealthOptions> = {}) =>
  analyzeScriptHealth(document(...nodes), { ...defaults, ...options });
const heading = (text: string, number?: string) => ({ ...block('sceneHeading', ...(text ? [text] : [])), attrs: { sceneNumber: number ?? null } });
const numbered = (type: string, text: string, number: string, extra = {}) =>
  ({ ...block(type, text), attrs: { elementNumber: number, elementNumberLocked: true, ...extra } });
const speech = (name = 'SARAH') => [block('character', name), block('dialogue', 'Hello.')];
const column = (...content: JSONContent[]) => ({ type: 'dualDialogueColumn', content });

describe('local script health', () => {
  it.each(['😀', '👩🏽', '👨‍👩‍👧‍👦', '🇮🇳', 'कि', 'क्ष', 'e\u0301'])('keeps the final %s grapheme intact in excerpts and scene context', cluster => {
    const expected = 'a'.repeat(179) + cluster;
    const text = '  ' + expected + 'extra\ntext  ';
    const findings = checks([heading(text), block('dialogue', text)], { notes: [{ id: 'lost', content: text }] });
    expect(findings.map(finding => finding.excerpt)).toEqual([expected, expected]);
    expect(findings[0].scene).toBe(expected);
    expect(findings[0].excerpt).not.toContain('\ufffd');
  });

  it('gates dialogue checks on the actual Character Enter flow without losing other checks', () => {
    const rules = INDUSTRY_STANDARD_TEMPLATE.rules;
    expect(healthOptionsForFormat(rules, true, []).dialogueChecks).toBe(true);
    const custom = { ...rules, character: { ...rules.character, nextOnEnter: 'parenthetical' } };
    const options = healthOptionsForFormat(custom, true, []);
    expect(options.dialogueChecks).toBe(false);
    expect(checks([heading(''), block('dialogue', 'No cue.')], options).map(finding => finding.check)).toEqual(['emptyScene']);
  });

  it.each(['character', 'dialogue'])('skips dialogue checks when %s is disabled', element => {
    const rules = INDUSTRY_STANDARD_TEMPLATE.rules;
    expect(healthOptionsForFormat({ ...rules, [element]: { ...rules[element], enabled: false } }, true, []).dialogueChecks).toBe(false);
  });
  it('accepts complete dialogue, parentheticals and continuation paragraphs', () => {
    expect(checks([heading('INT. ROOM - DAY'), block('action', 'A door opens.'), block('character', 'SARAH'),
      block('parenthetical', '(quietly)'), block('dialogue', 'Hello.'), block('dialogue', 'Anyone there?')])).toEqual([]);
  });
  it('reports an unfinished cue in its own scene, not the next scene', () => {
    const findings = checks([heading('INT. ROOM - DAY'), block('character', 'SARAH'), heading('EXT. STREET - DAY'), ...speech()]);
    expect(findings.map((finding) => [finding.check, finding.scene, finding.excerpt])).toEqual([
      ['missingDialogue', 'INT. ROOM - DAY', 'SARAH'],
    ]);
  });
  it('does not count empty dialogue as a completed speech', () => {
    expect(checks([block('character', 'SARAH'), block('dialogue')]).map((finding) => finding.check)).toEqual(['missingDialogue']);
  });
  it('reports orphan dialogue and parentheticals after an action interrupts a speech', () => {
    expect(checks([...speech(), block('action', 'She leaves.'), block('parenthetical', '(softly)'), block('dialogue', 'Goodbye.')])
      .map((finding) => finding.check)).toEqual(['orphanParenthetical', 'orphanDialogue']);
  });
  it('skips nonprinting annotations without breaking a speech and allows lyrics', () => {
    expect(checks([block('character', 'SARAH'), block('note', 'Private note'), block('section', 'Part one'), block('dialogue', 'Hello.')])).toEqual([]);
    expect(checks([block('character', 'SARAH'), block('lyrics', 'A song.')])).toEqual([]);
  });
  it('does not impose screenplay dialogue checks on other format flows', () => {
    expect(checks([block('character', 'SARAH'), block('action', 'A caption.')], { dialogueChecks: false })).toEqual([]);
  });
  it('treats dual-dialogue columns independently and returns actual text positions', () => {
    const doc = document({ type: 'dualDialogue', content: [column(...speech()), column(block('dialogue', 'No cue.'))] });
    const result = analyzeScriptHealth(doc, defaults);
    expect(result.map((finding) => finding.check)).toEqual(['orphanDialogue']);
    expect(doc.textBetween(result[0].position!, result[0].position! + 'No cue.'.length)).toBe('No cue.');
  });
  it('does not let an outside cue supply a dual-dialogue column', () => {
    expect(checks([block('character', 'OUTSIDE'), { type: 'dualDialogue', content: [column(...speech()), column(...speech('JAMES'))] }])
      .map((finding) => finding.check)).toEqual(['missingDialogue']);
  });
  it('does not scan AV cell dialogue using screenplay cue rules', () => {
    expect(checks([{ type: 'avBlock', content: [{ type: 'avRow', content: [
      { type: 'avCell', content: [block('dialogue', 'Voiceover without a cue.')] },
      { type: 'avCell', content: [block('avPara', 'A street.')] },
    ] }] }])).toEqual([]);
  });
  it('finds empty headings and ignores title/nonprinting text in the empty-script check', () => {
    expect(checks([block('titlePage', 'A title'), block('note', 'Private note'), heading('')])
      .map((finding) => finding.check)).toEqual(['emptyScene', 'emptyScript']);
  });
  it('flags every repeated scene reference case-insensitively without renumbering', () => {
    const doc = document(heading('INT. ROOM - DAY', '12a'), heading('EXT. STREET - DAY', '12A'));
    const before = doc.toJSON();
    expect(analyzeScriptHealth(doc, defaults).map((finding) => [finding.check, finding.reference]))
      .toEqual([['duplicateScene', '12a'], ['duplicateScene', '12A']]);
    expect(doc.toJSON()).toEqual(before);
  });
  it('keeps scene and element reference namespaces separate', () => {
    expect(checks([heading('INT. ROOM - DAY', '12'), numbered('action', 'The door opens.', '12')])).toEqual([]);
  });
  it('finds colliding locked references in one scope but accepts resets', () => {
    const options = { numbering: { action: { enabled: true, resetOn: ['sceneHeading'] } } };
    expect(checks([numbered('action', 'First.', '12A'), numbered('action', 'Second.', '12A')], options)
      .map((finding) => finding.check)).toEqual(['duplicateElement', 'duplicateElement']);
    expect(checks([heading('INT. ROOM - DAY'), numbered('action', 'First.', '12'),
      heading('EXT. STREET - DAY'), numbered('action', 'Second.', '12')], options)).toEqual([]);
  });
  it('checks shared countWith references but keeps independent counters separate', () => {
    const nodes = [numbered('action', 'First.', '12'), numbered('shot', 'Close-up.', '12')];
    expect(checks(nodes, { numbering: { action: { enabled: true, resetOn: [] }, shot: { enabled: true, resetOn: [] } } })).toEqual([]);
    expect(checks(nodes, { numbering: { action: { enabled: true, resetOn: [] }, shot: { enabled: true, resetOn: [], countWith: 'action' } } })
      .map((finding) => finding.check)).toEqual(['duplicateElement', 'duplicateElement']);
  });
  it('does not flag automatic stored numbers that the counter no longer displays', () => {
    expect(checks([numbered('action', 'First.', '12', { elementNumberAutomatic: true, elementNumberLocked: false }),
      numbered('action', 'Second.', '12', { elementNumberAutomatic: true, elementNumberLocked: false })], {
      numbering: { action: { enabled: true, resetOn: [] } },
    })).toEqual([]);
  });
  it('compares sparse imported labels conservatively per type and scene', () => {
    expect(checks([heading('INT. ROOM - DAY'), numbered('action', 'First.', '12'),
      heading('EXT. STREET - DAY'), numbered('action', 'Second.', '12')])).toEqual([]);
    expect(checks([numbered('action', 'First.', '12'), numbered('action', 'Second.', '12')])
      .map((finding) => finding.check)).toEqual(['duplicateElement', 'duplicateElement']);
  });
  it('uses actual note mark anchors and includes all unresolved notes', () => {
    const mark = { type: 'scriptNote', attrs: { noteId: 'note-1' } };
    const marked = { type: 'action', content: [{ type: 'text', text: 'She opens the door.', marks: [mark] }] };
    const doc = document(heading('INT. ROOM - DAY'), marked);
    const findings = analyzeScriptHealth(doc, { ...defaults, notes: [
      { id: 'note-1', content: 'Resolve this detail.' }, { id: 'lost', content: 'No longer anchored.' },
      { id: 'resolved', content: 'Done.', resolved: true }, { id: 'empty', content: ' ' },
    ] });
    expect(findings).toHaveLength(3);
    expect(findings[0]).toMatchObject({ check: 'openNote', scene: 'INT. ROOM - DAY', excerpt: 'Resolve this detail.' });
    expect(doc.textBetween(findings[0].position!, findings[0].position! + 3)).toBe('She');
    expect(findings[1].position).toBeNull();
  });
  it('recomputes findings from a new immutable document after edits', () => {
    const doc = document(block('character', 'SARAH'));
    const state = EditorState.create({ schema, doc });
    const next = state.apply(state.tr.insert(doc.content.size, schema.nodes.dialogue.create(null, schema.text('Hello.'))));
    expect(analyzeScriptHealth(doc, defaults)).toHaveLength(1);
    expect(analyzeScriptHealth(next.doc, defaults)).toEqual([]);
  });
  it('keeps Stage Play directions inside a speech without treating other custom blocks as directions', () => {
    const direction = { ...block('customElement', '(She turns.)'), attrs: { customTypeId: 'stageDirection' } };
    expect(checks([...speech(), direction, block('dialogue', 'Stay.')])).toEqual([]);
    expect(checks([...speech(), { ...direction, attrs: { customTypeId: 'caption' } }, block('dialogue', 'Stay.')])
      .map(finding => finding.check)).toEqual(['orphanDialogue']);
  });

  it('points at an empty cue instead of labelling its following dialogue orphaned', () => {
    const doc = document(heading('INT. ROOM - DAY', '12A'), block('character'), block('dialogue', 'Hello.'));
    const findings = analyzeScriptHealth(doc, defaults);
    expect(findings.map(finding => finding.check)).toEqual(['emptyCue']);
    expect(doc.resolve(findings[0].position!).parent.type.name).toBe('character');
    expect(findings[0].sceneNumber).toBe('12A');
  });

  it.each(['section', 'note', 'titlePage'])('keeps script-note anchors on %s blocks', type => {
    const marked = { type, content: [{ type: 'text', text: 'Anchored text', marks: [{ type: 'scriptNote', attrs: { noteId: 'hidden' } }] }] };
    const doc = document(heading('INT. ROOM - DAY', '2A'), marked);
    const findings = analyzeScriptHealth(doc, { ...defaults, notes: [{ id: 'hidden', content: 'Review this.' }] });
    expect(findings).toHaveLength(1);
    expect(findings[0].position).not.toBeNull();
    expect(doc.textBetween(findings[0].position!, findings[0].position! + 8)).toBe('Anchored');
    expect(findings[0].sceneNumber).toBe('2A');
  });

  it('retains unresolved threads with an empty root and uses reply text for the excerpt', () => {
    expect(checks([block('action', 'A door.')], { notes: [{ id: 'reply', content: ' ', replies: [{ content: 'Check the door.' }] }] }))
      .toMatchObject([{ check: 'openNote', noteId: 'reply', position: null, excerpt: 'Check the door.' }]);
  });

  it('uses production scene numbers with an ordinal fallback', () => {
    const findings = checks([heading('INT. ROOM - DAY', '12A'), block('dialogue', 'First orphan.'),
      heading('EXT. STREET - DAY'), block('dialogue', 'Second orphan.')]);
    expect(findings.map(finding => finding.sceneNumber)).toEqual(['12A', '2']);
  });

});
