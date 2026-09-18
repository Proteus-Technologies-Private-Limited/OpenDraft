/**
 * The element list offered inside an AV cell.
 *
 * Two things are being pinned down here, and they pull in opposite directions.
 *
 * The first is the load-bearing fallback: a document whose AV nodes are real
 * but whose *template* is not the AV one — an AV body inserted into a
 * screenplay, or an AV script restored without its template. The toolbar used
 * to filter the template's rules, so both produced an empty dropdown and a body
 * the writer could not type an element into. The four AV paragraph types are
 * therefore unconditional.
 *
 * The second is the template's authority over everything else: which screenplay
 * elements a two-column body may contain, and in which column, is a template
 * decision (`FormattingElementRule.avCell`) and not a structural one. The
 * schema accepts them all either way.
 */
import { describe, it, expect } from 'vitest';
import { avCellElementRules, avPlacementOf, allowedInAvCell, scriptBodyElementRules } from './avCellElements';
import { AV_SCRIPT_TEMPLATE } from '../stores/templates/avScriptTemplate';
import { INDUSTRY_STANDARD_TEMPLATE } from '../stores/industryStandardTemplate';
import { AV_BASE_CELL_ELEMENT_IDS } from '../editor/extensions/AvBlock';
import { SYSTEM_TEMPLATE_LIST } from '../stores/formattingTemplateStore';
import { testSchema } from '../test/screenplaySchema';
import { AV_BLOCK_RULE_ID, isTitlePageRuleId } from '../stores/formattingTypes';
import type { FormattingTemplate } from '../stores/formattingTypes';

const BASE = [...AV_BASE_CELL_ELEMENT_IDS];

/** A template with one rule replaced. */
function withRule(
  template: FormattingTemplate,
  id: string,
  patch: Record<string, unknown>,
): FormattingTemplate {
  return {
    ...template,
    rules: { ...template.rules, [id]: { ...template.rules[id], ...patch } },
  } as FormattingTemplate;
}

describe('avCellElementRules — the four AV paragraph types', () => {
  it('leads with them, in schema order, under the AV template', () => {
    for (const side of ['video', 'audio'] as const) {
      const ids = avCellElementRules(AV_SCRIPT_TEMPLATE, side).map((r) => r.id);
      expect(ids.slice(0, BASE.length)).toEqual(BASE);
    }
  });

  it('still offers them under a template that has no AV rules at all', () => {
    // Industry Standard is what a restored-without-its-template AV script falls
    // back to, and what an AV body inserted into a screenplay sits under.
    expect(INDUSTRY_STANDARD_TEMPLATE.rules.avPara).toBeUndefined();
    const ids = avCellElementRules(INDUSTRY_STANDARD_TEMPLATE, 'video').map((r) => r.id);
    expect(ids).toEqual(BASE);
  });

  it('survives no template at all', () => {
    expect(avCellElementRules(null).map((r) => r.id)).toEqual(BASE);
  });

  it('every offered type carries a label to show in the dropdown', () => {
    for (const rule of avCellElementRules(INDUSTRY_STANDARD_TEMPLATE, 'audio')) {
      expect(rule.label.trim()).not.toBe('');
    }
  });

  it("prefers the active template's own label when it defines one", () => {
    const custom = withRule(AV_SCRIPT_TEMPLATE, 'avShot', { label: 'Vision' });
    const shot = avCellElementRules(custom, 'video').find((r) => r.id === 'avShot');
    expect(shot?.label).toBe('Vision');
  });

  it('offers a type the template has disabled — the schema accepts it regardless', () => {
    const custom = withRule(AV_SCRIPT_TEMPLATE, 'avGraphic', { enabled: false });
    expect(avCellElementRules(custom, 'video').map((r) => r.id)).toContain('avGraphic');
  });
});

describe('avCellElementRules — what the template lets into a column', () => {
  it('puts the AV template’s screenplay elements in the column it named', () => {
    const video = avCellElementRules(AV_SCRIPT_TEMPLATE, 'video').map((r) => r.id);
    const audio = avCellElementRules(AV_SCRIPT_TEMPLATE, 'audio').map((r) => r.id);

    // Visual column: staging and camera.
    expect(video).toContain('action');
    expect(video).toContain('shot');
    expect(video).not.toContain('character');
    expect(video).not.toContain('dialogue');

    // Audio column: the people talking.
    expect(audio).toContain('character');
    expect(audio).toContain('dialogue');
    expect(audio).toContain('parenthetical');
    expect(audio).toContain('lyrics');
    expect(audio).not.toContain('action');
    expect(audio).not.toContain('shot');
  });

  it("offers 'both' in either column", () => {
    expect(avCellElementRules(AV_SCRIPT_TEMPLATE, 'video').map((r) => r.id)).toContain('general');
    expect(avCellElementRules(AV_SCRIPT_TEMPLATE, 'audio').map((r) => r.id)).toContain('general');
  });

  it('adds nothing beyond the four when no rule opts in', () => {
    // Every Industry Standard rule is 'none', so a screenplay's AV body behaves
    // exactly as it did before the field existed.
    for (const rule of Object.values(INDUSTRY_STANDARD_TEMPLATE.rules)) {
      expect(avPlacementOf(rule)).toBe('none');
    }
    expect(avCellElementRules(INDUSTRY_STANDARD_TEMPLATE, 'audio').map((r) => r.id)).toEqual(BASE);
  });

  it('honours a template that opts an element in', () => {
    const custom = withRule(INDUSTRY_STANDARD_TEMPLATE, 'dialogue', { avCell: 'audio' });
    expect(avCellElementRules(custom, 'audio').map((r) => r.id)).toContain('dialogue');
    expect(avCellElementRules(custom, 'video').map((r) => r.id)).not.toContain('dialogue');
  });

  it('honours a template that opts one out again', () => {
    const custom = withRule(AV_SCRIPT_TEMPLATE, 'character', { avCell: 'none' });
    expect(avCellElementRules(custom, 'audio').map((r) => r.id)).not.toContain('character');
  });

  it('will not offer a disabled element even where the placement allows it', () => {
    const custom = withRule(AV_SCRIPT_TEMPLATE, 'dialogue', { enabled: false });
    expect(avCellElementRules(custom, 'audio').map((r) => r.id)).not.toContain('dialogue');
  });

  it('never offers an element the cell could not hold', () => {
    // A New Act inside one cell of one row is not a thing anyone means, and the
    // schema would reject it — so opting it in must not put it in the menu.
    const custom = withRule(AV_SCRIPT_TEMPLATE, 'newAct', { avCell: 'both' });
    expect(avCellElementRules(custom, 'video').map((r) => r.id)).not.toContain('newAct');
  });

  it("offers a template's own custom element when it is opted in", () => {
    const custom: FormattingTemplate = {
      ...AV_SCRIPT_TEMPLATE,
      rules: {
        ...AV_SCRIPT_TEMPLATE.rules,
        soundEffect: {
          ...AV_SCRIPT_TEMPLATE.rules.avPara,
          id: 'soundEffect',
          label: 'Sound Effect',
          isBuiltIn: false,
          avCell: 'audio',
        },
      },
    } as FormattingTemplate;
    expect(avCellElementRules(custom, 'audio').map((r) => r.id)).toContain('soundEffect');
    expect(avCellElementRules(custom, 'video').map((r) => r.id)).not.toContain('soundEffect');
  });

  it('always includes whatever the caret is already on', () => {
    // However a paragraph got there — a template switch, an import, a document
    // written under different rules — it has to be convertible back.
    const ids = avCellElementRules(INDUSTRY_STANDARD_TEMPLATE, 'video', 'character').map((r) => r.id);
    expect(ids).toContain('character');
  });

  it('does not list the current element twice', () => {
    const ids = avCellElementRules(AV_SCRIPT_TEMPLATE, 'audio', 'dialogue').map((r) => r.id);
    expect(ids.filter((id) => id === 'dialogue')).toHaveLength(1);
  });
});

describe('avPlacementOf', () => {
  it('reads a missing field as "none"', () => {
    expect(avPlacementOf(undefined)).toBe('none');
    expect(avPlacementOf({ avCell: undefined } as never)).toBe('none');
  });

  it('rejects a value that is not a placement', () => {
    expect(avPlacementOf({ avCell: 'left' } as never)).toBe('none');
  });

  it('answers allowedInAvCell per side', () => {
    expect(allowedInAvCell({ avCell: 'both' } as never, 'video')).toBe(true);
    expect(allowedInAvCell({ avCell: 'both' } as never, 'audio')).toBe(true);
    expect(allowedInAvCell({ avCell: 'audio' } as never, 'video')).toBe(false);
    expect(allowedInAvCell({ avCell: 'none' } as never, 'audio')).toBe(false);
  });
});

describe('scriptBodyElementRules — the list outside a cell', () => {
  const notTitlePage = (id: string) => isTitlePageRuleId(id);

  it('never offers a cell-only type, in any system format', () => {
    // `setNode('avShot')` on a line of Action asks the schema for a node the
    // document cannot hold there. The AV template marks the four enabled —
    // that is how their formatting is edited — so filtering on `enabled` alone
    // put them in the body's element list, where nothing can apply them.
    for (const template of SYSTEM_TEMPLATE_LIST) {
      const ids = scriptBodyElementRules(template, notTitlePage).map((r) => r.id);
      for (const cellOnly of AV_BASE_CELL_ELEMENT_IDS) {
        expect(ids, `${template.name} offers ${cellOnly} outside a cell`).not.toContain(cellOnly);
      }
    }
  });

  it('every id it offers is something the body can actually become', () => {
    // Either a real top-level node, or an id that rides in on `customElement`,
    // or the one entry that is an insert rather than a conversion.
    for (const template of SYSTEM_TEMPLATE_LIST) {
      for (const rule of scriptBodyElementRules(template, notTitlePage)) {
        if (rule.id === AV_BLOCK_RULE_ID) continue;
        if (!rule.isBuiltIn) continue;
        const node = testSchema.nodes[rule.id];
        expect(node, `${template.name}/${rule.id} is not a node`).toBeTruthy();
        expect(node.isTextblock, `${template.name}/${rule.id} is not a textblock`).toBe(true);
      }
    }
  });

  it('keeps AV Columns where the template enables it', () => {
    const ids = scriptBodyElementRules(AV_SCRIPT_TEMPLATE, notTitlePage).map((r) => r.id);
    expect(ids).toContain(AV_BLOCK_RULE_ID);
  });

  it('drops AV Columns where the template disables it', () => {
    const off = withRule(AV_SCRIPT_TEMPLATE, AV_BLOCK_RULE_ID, { enabled: false });
    expect(scriptBodyElementRules(off, notTitlePage).map((r) => r.id)).not.toContain(AV_BLOCK_RULE_ID);
  });

  it('still drops the title page', () => {
    const ids = scriptBodyElementRules(INDUSTRY_STANDARD_TEMPLATE, notTitlePage).map((r) => r.id);
    expect(ids.some(isTitlePageRuleId)).toBe(false);
  });

  it('never offers AV Columns inside a cell — an AV body does not nest', () => {
    for (const side of ['video', 'audio'] as const) {
      expect(avCellElementRules(AV_SCRIPT_TEMPLATE, side).map((r) => r.id))
        .not.toContain(AV_BLOCK_RULE_ID);
    }
  });
});
