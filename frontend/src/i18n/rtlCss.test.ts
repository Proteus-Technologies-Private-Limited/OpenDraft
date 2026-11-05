/**
 * The generated right-to-left stylesheet: the chrome mirrors, the script page
 * and the left-to-right UI do not change. (vite.rtl.ts)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { rtlPlugins, PAGE_SELECTOR } from '../../vite.rtl';

const STYLES = join(__dirname, '..', 'styles');
const run = async (css: string, file = 'x.css') => (await postcss(rtlPlugins()).process(css, { from: file })).css;

describe('mirroring the interface', () => {
  it('adds a [dir="rtl"] rule beside a directional rule and keeps the original', async () => {
    const out = await run('.menu { margin-left: 8px; text-align: left; }');
    expect(out).toContain('.menu { margin-left: 8px; text-align: left; }');
    expect(out).toMatch(/\[dir="rtl"\] \.menu\s*\{[^}]*margin-right: 8px/);
    expect(out).toMatch(/\[dir="rtl"\] \.menu\s*\{[^}]*text-align: right/);
  });

  it('adds nothing for a rule with no direction in it', async () => {
    const css = '.btn { color: red; padding: 4px 8px; }';
    expect((await run(css)).trim()).toBe(css);
  });

  it('flips a left/right offset', async () => {
    expect(await run('.close { position: absolute; right: 12px; }')).toMatch(/\[dir="rtl"\] \.close\s*\{[^}]*left: 12px/);
  });
});

describe('the script page is never mirrored', () => {
  it.each([
    '.page { padding-left: 1.5in; }',
    '.dialogue { margin-left: 1in; margin-right: 1.5in; }',
    '.character { margin-left: 2in; }',
    '.screenplay-element { text-align: left; }',
    '.page-sep-hf-left { text-align: left; }',
    '.dual-dialogue-column + .dual-dialogue-column { margin-left: 8px; }',
    'div[data-type="action"].is-empty::before { float: left; }',
    '.ProseMirror .scene-heading::before { left: -0.5in; }',
  ])('leaves %s alone', async (css) => {
    expect(await run(css)).not.toContain('[dir="rtl"] .');
  });

  it('does not mistake chrome whose name starts like a page class for the page', async () => {
    for (const sel of ['.dialogue-tuner-hear', '.page-setup-reset', '.note-item', '.character-card', '.scene-navigator']) {
      expect(PAGE_SELECTOR.test(sel), sel).toBe(false);
      expect(await run(`${sel} { margin-left: 8px; }`)).toContain(`[dir="rtl"] ${sel}`);
    }
  });

  it('leaves AV script stylesheets alone entirely', async () => {
    expect(await run('.something { margin-left: 8px; }', 'avScript.css')).not.toContain('[dir="rtl"]');
  });

  it('pins the page left-to-right inside screenplay.css', async () => {
    const out = await run('.x { color: red; }', 'screenplay.css');
    expect(out).toMatch(/\[dir="rtl"\] \.page,[\s\S]*direction: ltr/);
  });
});

describe('the real stylesheets', () => {
  const screenplay = readFileSync(join(STYLES, 'screenplay.css'), 'utf8');

  it('changes nothing in the left-to-right stylesheet', async () => {
    const out = await run(screenplay, join(STYLES, 'screenplay.css'));
    const generated = postcss.parse(out);
    // Take out what the plugins added — the [dir="rtl"] rules and the marker
    // comments — and what is left must be the source, unchanged.
    generated.walkRules((r) => {
      if (/^(html)?\[dir="rtl"\]/.test(r.selector)) r.remove();
    });
    generated.walkComments((c) => {
      if (c.text.trim() === 'rtl:ignore') c.remove();
    });
    // An at-rule left empty by the removals (a @media that held only mirrored rules) was ours too.
    generated.walkAtRules((a) => {
      if (a.nodes && a.nodes.length === 0 && !postcss.parse(screenplay).toString().includes(a.toString().trim())) a.remove();
    });
    const norm = (css: string) => css.replace(/\s+/g, ' ').trim();
    expect(norm(generated.toString())).toBe(norm(screenplay));
  });

  it('mirrors a meaningful share of the chrome and none of the page', async () => {
    const out = await run(screenplay, join(STYLES, 'screenplay.css'));
    const root = postcss.parse(out);
    const rtlRules: string[] = [];
    root.walkRules((r) => {
      if (/^(html)?\[dir="rtl"\]/.test(r.selector) && !r.selector.includes('direction')) rtlRules.push(r.selector);
    });
    expect(rtlRules.length).toBeGreaterThan(150);
    const leaked = rtlRules
      // the deliberate pin is a rule that only sets `direction`
      .filter((sel) => PAGE_SELECTOR.test(sel.replace(/\[dir="rtl"\]\s*/g, '')))
      .filter((sel) => !sel.includes('.page,'));
    expect(leaked).toEqual([]);
  });

  it('processes the other stylesheets without error', async () => {
    for (const f of ['avScript.css', 'statistics.css', 'tableRead.css']) {
      await expect(run(readFileSync(join(STYLES, f), 'utf8'), join(STYLES, f))).resolves.toBeTypeOf('string');
    }
  });
});
