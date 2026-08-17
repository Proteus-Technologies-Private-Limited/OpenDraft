/**
 * Doc-first Fountain round trips: `doc → fountain → doc`.
 *
 * The existing suites cover each direction on its own, and `fountainParser.test.ts`
 * has one round trip — but it is *text*-first (`text → doc → text`), which starts
 * from hand-written Fountain that is already well-formed. Every defect behind
 * issue #75 lives in the other direction: a document built by the FDX/OSF
 * importers is serialized into Fountain that the parser then cannot read back.
 *
 * Saving a `.fountain` opened in place runs exactly this path on ⌘S, so a
 * regression here is silent corruption of the writer's own file.
 */
import { describe, it, expect } from 'vitest';
import { exportFountain } from './fountainExporter';
import { parseFountain } from './fountainParser';
import { doc, block, marked } from '../test/screenplaySchema';
import { titleRegionOf, titleNodeOf, bodyTypesOf } from '../test/titlePage';
import type { JSONContent } from '@tiptap/react';

/** The element types of a parsed document, in order. */
function types(parsed: JSONContent): string[] {
  return (parsed.content ?? []).map((n) => n.type as string);
}

/** Concatenated plain text of the nth block. */
function textOf(parsed: JSONContent, index: number): string {
  const node = (parsed.content ?? [])[index];
  return (node?.content ?? []).map((c) => c.text ?? '').join('');
}

/** Mark names carried by the nth block's first text run. */
function marksOf(parsed: JSONContent, index: number): string[] {
  const node = (parsed.content ?? [])[index];
  const run = (node?.content ?? [])[0];
  return (run?.marks ?? []).map((m) => m.type as string).sort();
}

const roundTrip = (d: JSONContent) => parseFountain(exportFountain(d));

describe('Fountain round trip: scene headings', () => {
  it('keeps a bold scene heading a scene heading', () => {
    // FDX and Fade In both bold headings by default, so their importers attach a
    // real bold mark. Exported naively that became `**47 EXT. FOO**`, which fails
    // the anchored heading regex and was then read as a character cue.
    const out = roundTrip(doc(marked('sceneHeading', 'INT. HOUSE - DAY', 'bold')));
    expect(types(out)).toEqual(['sceneHeading']);
    expect(textOf(out, 0)).toBe('INT. HOUSE - DAY');
  });

  it('does not leak literal asterisks from a bold heading', () => {
    const fountain = exportFountain(doc(marked('sceneHeading', 'INT. HOUSE - DAY', 'bold')));
    expect(fountain).not.toMatch(/\*\*INT/);
    expect(textOf(roundTrip(doc(marked('sceneHeading', 'INT. HOUSE - DAY', 'bold'))), 0))
      .not.toContain('*');
  });

  it('keeps a heading that does not start with INT./EXT.', () => {
    const out = roundTrip(doc(block('sceneHeading', 'BLACK SCREEN'), block('action', 'Silence.')));
    expect(types(out)).toEqual(['sceneHeading', 'action']);
    expect(textOf(out, 0)).toBe('BLACK SCREEN');
  });

  it('keeps a heading whose scene number is baked into the text', () => {
    // The exact shape from issue #75.
    const out = roundTrip(doc(marked('sceneHeading', '47 EXT. FOO', 'bold')));
    expect(types(out)).toEqual(['sceneHeading']);
    expect(textOf(out, 0)).toBe('47 EXT. FOO');
  });

  it('preserves a sceneNumber attribute as trailing #n#', () => {
    const heading = { ...block('sceneHeading', 'INT. HOUSE - DAY'), attrs: { sceneNumber: '47' } };
    expect(exportFountain(doc(heading))).toContain('#47#');
  });

  it('does not turn the action under a heading into dialogue', () => {
    const out = roundTrip(doc(
      marked('sceneHeading', '47 EXT. FOO', 'bold'),
      block('action', 'A car pulls up.'),
    ));
    expect(types(out)).toEqual(['sceneHeading', 'action']);
    expect(types(out)).not.toContain('dialogue');
  });
});

describe('Fountain round trip: emphasis', () => {
  it('survives a bold run with a trailing space', () => {
    // `**word **` is not bold per the spec — the delimiter must sit against a
    // non-space. The exporter has to move the space outside the delimiters.
    const out = roundTrip(doc(marked('action', 'bold text ', 'bold')));
    expect(textOf(out, 0)).toBe('bold text');
    expect(textOf(out, 0)).not.toContain('*');
    expect(marksOf(out, 0)).toEqual(['bold']);
  });

  it('survives a bold run with a leading space', () => {
    const out = roundTrip(doc(marked('action', ' bold text', 'bold')));
    expect(textOf(out, 0)).not.toContain('*');
  });

  it('handles two emphasis runs where the first is one character', () => {
    const out = roundTrip(doc({
      type: 'action',
      content: [
        { type: 'text', text: 'A', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'B', marks: [{ type: 'bold' }] },
      ],
    }));
    expect(textOf(out, 0)).toBe('A and B');
    expect(textOf(out, 0)).not.toContain('*');
  });

  it('merges adjacent runs carrying the same marks', () => {
    // FDX emits `<Text Style="Bold">47 </Text><Text Style="Bold">EXT. FOO</Text>`.
    // Unmerged that exported as `**47 ****EXT. FOO**`.
    const fountain = exportFountain(doc({
      type: 'action',
      content: [
        { type: 'text', text: '47 ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'EXT. FOO', marks: [{ type: 'bold' }] },
      ],
    }));
    expect(fountain).not.toContain('****');
  });

  it('round-trips bold+italic as ***', () => {
    const out = roundTrip(doc(marked('action', 'both', 'bold', 'italic')));
    expect(marksOf(out, 0)).toEqual(['bold', 'italic']);
    expect(textOf(out, 0)).toBe('both');
  });

  it('round-trips underline wrapped around bold', () => {
    const out = roundTrip(doc(marked('action', 'BOLD', 'bold', 'underline')));
    expect(marksOf(out, 0)).toEqual(['bold', 'underline']);
    expect(textOf(out, 0)).toBe('BOLD');
  });
});

describe('Fountain round trip: literal characters the writer typed', () => {
  it('does not read arithmetic as emphasis', () => {
    const out = roundTrip(doc(block('action', 'He rolls 5 * 3 * 2 dice.')));
    expect(textOf(out, 0)).toBe('He rolls 5 * 3 * 2 dice.');
    expect(marksOf(out, 0)).toEqual([]);
  });

  it('preserves underscores in ordinary text', () => {
    const out = roundTrip(doc(block('action', 'The file is snake_case_name here.')));
    expect(textOf(out, 0)).toBe('The file is snake_case_name here.');
  });

  it('preserves a literal backslash', () => {
    const out = roundTrip(doc(block('action', 'A back\\slash.')));
    expect(textOf(out, 0)).toBe('A back\\slash.');
  });
});

describe('Fountain round trip: element types that shadow a cue', () => {
  it('keeps an all-caps Action line as Action', () => {
    const out = roundTrip(doc(block('action', 'THE DOOR SLAMS.'), block('action', 'Then quiet.')));
    expect(types(out)).toEqual(['action', 'action']);
  });

  it('keeps General as its own indented block, not dialogue', () => {
    const out = roundTrip(doc(
      block('character', 'JOHN'),
      block('dialogue', 'Hello.'),
      block('general', 'ARCHIVE RECORD 12'),
    ));
    expect(types(out)).toEqual(['character', 'dialogue', 'action']);
    expect(textOf(out, 2)).toBe('ARCHIVE RECORD 12');
  });

  it('keeps consecutive General blocks separate', () => {
    const out = roundTrip(doc(block('general', 'FIRST LINE'), block('general', 'SECOND LINE')));
    expect(out.content).toHaveLength(2);
    expect(textOf(out, 0)).toBe('FIRST LINE');
    expect(textOf(out, 1)).toBe('SECOND LINE');
  });

  it('preserves deliberate indentation in General', () => {
    // Fountain retains tabs and spaces in Action, which is what forced-Action
    // General relies on for onscreen records and other hand-aligned blocks.
    const out = roundTrip(doc(block('general', '    INDENTED ENTRY')));
    expect(textOf(out, 0)).toBe('    INDENTED ENTRY');
  });

  it('does not turn an act marker into a character cue', () => {
    const out = roundTrip(doc(block('newAct', 'ACT ONE'), block('action', 'We open.')));
    expect(types(out)).not.toContain('character');
    expect(types(out)).not.toContain('dialogue');
  });

  it('keeps a real character cue and its dialogue', () => {
    const out = roundTrip(doc(block('character', 'JOHN'), block('dialogue', 'Hello.')));
    expect(types(out)).toEqual(['character', 'dialogue']);
    expect(textOf(out, 0)).toBe('JOHN');
    expect(textOf(out, 1)).toBe('Hello.');
  });

  it('does not read a lone all-caps line as a cue', () => {
    // The spec's character rule has two halves — an empty line before, and no
    // empty line after. Only the first was checked, so "FADE IN:" became a cue
    // and whatever followed it became that character's dialogue.
    const out = parseFountain('FADE IN:\n\nA machine hums.\n');
    expect(types(out)).toEqual(['action', 'action']);
  });
});

describe('Fountain round trip: the title page', () => {
  const titlePage = () => doc(
    {
      type: 'titlePage',
      attrs: { field: 'title', tpTitle: 'My Film', tpWrittenBy: 'A Writer' },
      content: [],
    },
    block('sceneHeading', 'INT. LAB - DAY'),
  );

  it('survives, instead of coming back as stray Action', () => {
    // The exporter has always written `Title:` / `Author:`, and the parser had
    // no title-page rule — so its own output reopened with two lines of Action
    // at the top and the title page gone. On an in-place `.fountain` that
    // happened on every save.
    const out = roundTrip(titlePage());
    // The parser expands the title page into the laid-out run the paginator and
    // exporters measure, so this asserts the region rather than a node count.
    expect(titleRegionOf(out).isReal).toBe(true);
    expect(bodyTypesOf(out)).toEqual(['sceneHeading']);
  });

  it('keeps the field values', () => {
    const node = titleNodeOf(roundTrip(titlePage()));
    expect(node?.attrs?.tpTitle).toBe('My Film');
    expect(node?.attrs?.tpWrittenBy).toBe('A Writer');
  });

  it('is not invented for a script that merely opens with a colon', () => {
    // "JANE: hello" is dialogue-ish prose, not a title page.
    const out = parseFountain('Something happened: it was odd.\n\nMore action.\n');
    expect(types(out)[0]).toBe('action');
  });

  it('does not swallow a script that opens with a scene heading', () => {
    const out = parseFountain('INT. LAB - DAY\n\nAction here.\n');
    expect(types(out)).toEqual(['sceneHeading', 'action']);
  });
});
