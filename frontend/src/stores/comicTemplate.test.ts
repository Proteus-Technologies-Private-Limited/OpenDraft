/**
 * The Comic Book format (stores/templates/comicTemplate): its elements flow
 * into one another, and a new script made from it is numbered the way a comic
 * full script is — PAGE ONE, PANEL 1 again on every page, captions and
 * balloons lettered in one run down each page.
 */
import { describe, it, expect } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import { SYSTEM_TEMPLATES, SYSTEM_TEMPLATE_LIST, findTemplate } from './formattingTemplateStore';
import {
  COMIC_TEMPLATE, COMIC_ID, COMIC_PAGE, COMIC_PANEL, COMIC_CAPTION, COMIC_SFX, COMIC_ARTIST_NOTE,
} from './templates/comicTemplate';
import { AV_BLOCK_RULE_ID } from './formattingTypes';
import { numberingRulesOf, withElementNumbers, elementNumberOf } from '../utils/elementNumbers';
import { testSchema } from '../test/screenplaySchema';

const starter = (): JSONContent => ({ type: 'doc', content: COMIC_TEMPLATE.starterDocument as JSONContent[] });
const textOf = (n: JSONContent): string => (n.content ?? []).map((c) => c.text ?? '').join('');

describe('Comic Book format', () => {
  it('is offered in the format picker', () => {
    expect(SYSTEM_TEMPLATES[COMIC_ID]).toBe(COMIC_TEMPLATE);
    expect(SYSTEM_TEMPLATE_LIST).toContain(COMIC_TEMPLATE);
    expect(findTemplate(COMIC_ID)).toBe(COMIC_TEMPLATE);
    expect(COMIC_TEMPLATE.category).toBe('system');
  });

  it('has the comic elements, and every Enter and Tab lands on an element it offers', () => {
    const { rules } = COMIC_TEMPLATE;
    for (const id of [COMIC_PAGE, COMIC_PANEL, COMIC_CAPTION, COMIC_SFX, COMIC_ARTIST_NOTE, 'action', 'character', 'dialogue']) {
      expect(rules[id]?.enabled, id).toBe(true);
    }
    for (const r of Object.values(rules)) {
      if (!r.enabled || r.id === AV_BLOCK_RULE_ID) continue;
      expect(rules[r.nextOnEnter]?.enabled, `${r.id} → Enter → ${r.nextOnEnter}`).toBe(true);
      if (r.nextOnTab) expect(rules[r.nextOnTab]?.enabled, `${r.id} → Tab → ${r.nextOnTab}`).toBe(true);
    }
    // The writing loop: page → panel → description → character → balloon → character…
    expect(rules[COMIC_PAGE].nextOnEnter).toBe(COMIC_PANEL);
    expect(rules[COMIC_PANEL].nextOnEnter).toBe('action');
    expect(rules.action.nextOnEnter).toBe('character');
    expect(rules.character.nextOnEnter).toBe('dialogue');
    expect(rules.dialogue.nextOnEnter).toBe('character');
    expect(rules.dialogue.nextOnTab).toBe(COMIC_PANEL);
  });

  it('starts every comic page on a new sheet', () => {
    expect(COMIC_TEMPLATE.forceBreakBefore).toEqual([COMIC_PAGE]);
  });

  it('numbers pages, panels and lettering, and nothing else', () => {
    expect(Object.keys(numberingRulesOf(COMIC_TEMPLATE.rules)).sort())
      .toEqual([COMIC_CAPTION, COMIC_PAGE, COMIC_PANEL, 'dialogue'].sort());
  });

  it('starts a new script that is valid for the editor', () => {
    expect(() => testSchema.nodeFromJSON(starter()).check()).not.toThrow();
  });

  it('numbers the starter script the way a comic script reads', () => {
    const rules = numberingRulesOf(COMIC_TEMPLATE.rules);
    const out = withElementNumbers(starter(), { visible: true, sceneNumbersVisible: true, rules, inlineAsText: true });
    const lines = (out.content ?? []).map((n) => {
      const number = elementNumberOf(n);
      return number ? `${number} | ${textOf(n)}` : textOf(n);
    });
    expect(lines.filter((l) => /^(PAGE|PANEL|\d)/.test(l))).toEqual([
      'PAGE ONE (TWO PANELS)',
      'PANEL 1',
      '1 | CAPTION: The northern coast. 1953.',
      'PANEL 2',
      '2 | Twenty years, and it has never once gone dark.',
      '3 | Until tonight.',
      'PAGE TWO (SPLASH)',
      'PANEL 1',
    ]);
  });
});
