import { describe, it, expect } from 'vitest';
import { typographyIssues, checkNamespace, flatten, placeholders, tags, scriptCoverage, pluralCategories } from './localeCheck';

const en = {
  save: 'Save',
  greet: 'Hello {{name}}',
  note: 'Press <b>Enter</b> to {{action}}',
  scenes_one: '{{count}} scene',
  scenes_other: '{{count}} scenes',
  group: { title: 'Title', hint: 'A hint here' },
};

const ok = {
  es: {
    save: 'Guardar',
    greet: 'Hola {{name}}',
    note: 'Pulsa <b>Intro</b> para {{action}}',
    scenes_one: '{{count}} escena',
    scenes_many: '{{count}} de escenas',
    scenes_other: '{{count}} escenas',
    group: { title: 'Título', hint: 'Una pista aquí' },
  },
};

const run = (lang: string, target: object, source: object = en) =>
  checkNamespace('t', source as never, target as never, { lang });

describe('flatten', () => {
  it('joins nested keys with dots', () => {
    expect(flatten({ a: { b: 'x', c: { d: 'y' } } })).toEqual({ 'a.b': 'x', 'a.c.d': 'y' });
  });
  it('rejects arrays and non-strings', () => {
    expect(() => flatten({ a: ['x'] } as never)).toThrow(/array/);
    expect(() => flatten({ a: 3 } as never)).toThrow(/number/);
  });
});

describe('placeholders and tags', () => {
  it('reads {{name}} and {{name, fmt}}', () => {
    expect(placeholders('a {{x}} b {{ y , number }}')).toEqual(['x', 'y']);
  });
  it('reads tags', () => {
    expect(tags('a <b>b</b> <0>c</0> <br/>')).toEqual(['b', 'b', '0', '0', 'br']);
  });
});

describe('checkNamespace', () => {
  it('accepts a faithful translation', () => {
    expect(run('es', ok.es)).toEqual([]);
  });

  it('reports a missing and an extra key', () => {
    const t = { ...ok.es, extra: 'x' } as Record<string, unknown>;
    delete t.save;
    const out = run('es', t).join('\n');
    expect(out).toMatch(/missing key "save"/);
    expect(out).toMatch(/extra key "extra"/);
  });

  it('reports a lost or invented placeholder', () => {
    expect(run('es', { ...ok.es, greet: 'Hola' }).join()).toMatch(/lost the placeholder \{\{name\}\}/);
    expect(run('es', { ...ok.es, greet: 'Hola {{nombre}}' }).join()).toMatch(/unknown placeholder \{\{nombre\}\}/);
    expect(run('es', { ...ok.es, greet: 'Hola {{name}' }).join()).toMatch(/unbalanced|lost/);
  });

  it('reports changed markup', () => {
    expect(run('es', { ...ok.es, note: 'Pulsa Intro para {{action}}' }).join()).toMatch(/changed its markup/);
    expect(run('es', { ...ok.es, note: 'Pulsa <i>Intro</i> para {{action}}' }).join()).toMatch(/changed its markup/);
  });

  it('reports an empty value and a key shown as its own value', () => {
    expect(run('es', { ...ok.es, save: '  ' }).join()).toMatch(/"save" is empty/);
    expect(run('es', { ...ok.es, save: 'save' }).join()).toMatch(/shows its own key/);
  });

  it('reports a string left in English', () => {
    expect(run('es', { ...ok.es, group: { title: 'Title', hint: 'A hint here' } }).join()).toMatch(/still English/);
  });

  it('lets a brand name stay', () => {
    const src = { brand: 'OpenDraft Pro' };
    const out = checkNamespace('t', src, src, { lang: 'es', sameAsEnglishOk: (s) => /OpenDraft/.test(s) });
    expect(out).toEqual([]);
  });

  it('requires the plural forms the language has', () => {
    // Russian: one / few / many / other
    const ru = { ...ok.es, scenes_one: '{{count}} сцена', scenes_other: '{{count}} сцены' } as Record<string, unknown>;
    delete ru.scenes_many;
    const out = run('ru', ru).join('\n');
    expect(out).toMatch(/lacks the "few" plural form/);
    expect(out).toMatch(/lacks the "many" plural form/);
  });

  it('rejects a plural form the language does not use', () => {
    const t = { ...ok.es, scenes_few: 'x' };
    expect(run('es', t).join()).toMatch(/not a plural form of es/);
  });

  it('needs the "many" form in Spanish, French and Portuguese too', () => {
    // Without it i18next shows the raw key for exactly 1,000,000 — see docs/i18n.md.
    for (const lang of ['es', 'fr', 'pt']) expect(pluralCategories(lang)).toContain('many');
    const noMany = { ...ok.es } as Record<string, unknown>;
    delete noMany.scenes_many;
    expect(run('es', noMany).join()).toMatch(/lacks the "many" plural form/);
  });

  it('accepts all six forms for Arabic', () => {
    expect(pluralCategories('ar').sort()).toEqual(['few', 'many', 'one', 'other', 'two', 'zero']);
    expect(pluralCategories('fa').sort()).toEqual(['one', 'other']);
    expect(pluralCategories('tr').sort()).toEqual(['one', 'other']);
    expect(pluralCategories('ru').sort()).toEqual(['few', 'many', 'one', 'other']);
  });

  it('allows a plural form to drop {{count}}', () => {
    const t = { ...ok.es, scenes_one: 'una escena' };
    expect(run('es', t)).toEqual([]);
  });

  it('survives non-object input', () => {
    expect(run('es', { save: ['x'] })[0]).toMatch(/array/);
  });
});

describe('scriptCoverage', () => {
  it('counts strings that contain the language script', () => {
    const e = { a: 'Save', b: 'Open file', c: '123' };
    const r = scriptCoverage({ a: 'Сохранить', b: 'Open file', c: '123' }, /\p{Script=Cyrillic}/u, e);
    expect(r).toEqual({ total: 2, hit: 1, missing: ['b'] });
  });
});

describe('typographyIssues', () => {
  it('rejects Arabic letters in Persian and the reverse', () => {
    expect(typographyIssues('fa', 'كتاب')[0]).toMatch(/Persian needs/);
    expect(typographyIssues('fa', 'کتاب')).toEqual([]);
    expect(typographyIssues('ar', 'کتاب')[0]).toMatch(/Arabic needs/);
    expect(typographyIssues('ar', 'كتاب')).toEqual([]);
  });
  it('wants a no-break space before French punctuation', () => {
    expect(typographyIssues('fr', 'Enregistrer : oui')[0]).toMatch(/no-break/);
    expect(typographyIssues('fr', 'Enregistrer\u00A0: oui')).toEqual([]);
    expect(typographyIssues('fr', 'Aller sur https://a.b')).toEqual([]);
  });
  it('wants Spanish question marks opened', () => {
    expect(typographyIssues('es', 'Guardar?')[0]).toMatch(/opening/);
    expect(typographyIssues('es', '¿Guardar?')).toEqual([]);
  });
  it('ignores placeholders and tags', () => {
    expect(typographyIssues('fr', 'Fichier\u00A0: {{name}}')).toEqual([]);
  });
});
