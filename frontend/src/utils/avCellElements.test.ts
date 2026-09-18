/**
 * The element list offered inside an AV cell.
 *
 * The load-bearing case is a document whose AV nodes are real but whose
 * *template* is not the AV one — an AV body inserted into a screenplay, or an
 * AV script restored without its template. The toolbar filtered the template's
 * rules, so both produced an empty dropdown and a body the writer could not
 * type an element into.
 */
import { describe, it, expect } from 'vitest';
import { avCellElementRules } from './avCellElements';
import { AV_SCRIPT_TEMPLATE } from '../stores/templates/avScriptTemplate';
import { INDUSTRY_STANDARD_TEMPLATE } from '../stores/industryStandardTemplate';
import { AV_CELL_ELEMENT_IDS } from '../editor/extensions/AvBlock';

describe('avCellElementRules', () => {
  it('offers every AV cell type under the AV template', () => {
    const ids = avCellElementRules(AV_SCRIPT_TEMPLATE).map((r) => r.id);
    expect(ids).toEqual([...AV_CELL_ELEMENT_IDS]);
  });

  it('still offers them under a template that has no AV rules at all', () => {
    // Industry Standard is what a restored-without-its-template AV script falls
    // back to, and what an AV body inserted into a screenplay sits under.
    expect(INDUSTRY_STANDARD_TEMPLATE.rules.avPara).toBeUndefined();
    const ids = avCellElementRules(INDUSTRY_STANDARD_TEMPLATE).map((r) => r.id);
    expect(ids).toEqual([...AV_CELL_ELEMENT_IDS]);
  });

  it('survives no template at all', () => {
    expect(avCellElementRules(null).map((r) => r.id)).toEqual([...AV_CELL_ELEMENT_IDS]);
  });

  it('every offered type carries a label to show in the dropdown', () => {
    for (const rule of avCellElementRules(INDUSTRY_STANDARD_TEMPLATE)) {
      expect(rule.label.trim()).not.toBe('');
    }
  });

  it("prefers the active template's own label when it defines one", () => {
    const custom = {
      ...AV_SCRIPT_TEMPLATE,
      rules: {
        ...AV_SCRIPT_TEMPLATE.rules,
        avShot: { ...AV_SCRIPT_TEMPLATE.rules.avShot, label: 'Vision' },
      },
    };
    const shot = avCellElementRules(custom).find((r) => r.id === 'avShot');
    expect(shot?.label).toBe('Vision');
  });

  it('offers a type the template has disabled — the schema accepts it regardless', () => {
    const custom = {
      ...AV_SCRIPT_TEMPLATE,
      rules: {
        ...AV_SCRIPT_TEMPLATE.rules,
        avGraphic: { ...AV_SCRIPT_TEMPLATE.rules.avGraphic, enabled: false },
      },
    };
    expect(avCellElementRules(custom).map((r) => r.id)).toContain('avGraphic');
  });
});
