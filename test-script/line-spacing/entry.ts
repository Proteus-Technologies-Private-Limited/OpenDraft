/**
 * Browser half of test-script/measure_line_spacing.sh.
 *
 * Runs the app's own code in real Chrome: the line-spacing CSS the editor
 * injects (utils/templateCss) laid out against the real screenplay.css, and the
 * .fdx export → import round trip through the real `parseFDXFull`, which needs
 * a browser DOM (querySelector) that vitest's node environment lacks.
 */
import { generateLineSpacingCss } from '../../frontend/src/utils/templateCss';
import { exportFDX } from '../../frontend/src/utils/fdxExporter';
import { parseFDXFull } from '../../frontend/src/utils/fdxParser';
import { useFormattingTemplateStore } from '../../frontend/src/stores/formattingTemplateStore';
import { INDUSTRY_STANDARD_TEMPLATE } from '../../frontend/src/stores/industryStandardTemplate';
import { MULTICAM_SITCOM_TEMPLATE } from '../../frontend/src/stores/templates/multicamSitcomTemplate';
import type { FormattingTemplate } from '../../frontend/src/stores/formattingTypes';

const out: string[] = [];
let failures = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) failures++;
  out.push(`${ok ? 'ok  ' : 'FAIL'} ${line}`);
};

function lineTops(el: Element): number[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  const tops: number[] = [];
  for (const r of Array.from(range.getClientRects())) {
    const top = Math.round(r.top * 100) / 100;
    if (r.width > 0 && !tops.some((t) => Math.abs(t - top) < 2)) tops.push(top);
  }
  return tops.sort((a, b) => a - b);
}

function template(lineSpacing: number, sitcom = false): FormattingTemplate {
  const base = sitcom ? MULTICAM_SITCOM_TEMPLATE : INDUSTRY_STANDARD_TEMPLATE;
  return { ...base, id: 'measure', category: 'user', ...(lineSpacing !== 1 ? { lineSpacing } : {}) };
}

function measure(): void {
  const style = document.getElementById('generated') as HTMLStyleElement;
  const page = document.getElementById('content')!;
  const cases: Array<[string, number, boolean]> = [
    ['standard', 1, false], ['slightly open', 1.125, false], ['open', 1.25, false],
    ['1.5', 1.5, false], ['double', 2, false], ['sitcom', 1, true], ['sitcom + open', 1.25, true],
  ];
  for (const [name, spacing, sitcom] of cases) {
    const tpl = template(spacing, sitcom);
    style.textContent = generateLineSpacingCss(tpl);
    if (name === 'standard') check(style.textContent === '', 'standard emits no CSS');
    for (const id of ['plain', 'styled', 'mixed', 'dialogue', 'title']) {
      const el = document.getElementById(id)!;
      const type = id === 'dialogue' ? 'dialogue' : 'action';
      const expected = id === 'title' ? 16 : 16 * (sitcom && type === 'dialogue' ? 2 * spacing : spacing);
      const tops = lineTops(el);
      const pitches = tops.slice(1).map((t, i) => Math.round((t - tops[i]) * 100) / 100);
      const height = el.getBoundingClientRect().height;
      check(
        tops.length > 1 && pitches.every((p) => p === expected) && height === tops.length * expected,
        `${name} ${id}: ${tops.length} lines, pitches ${JSON.stringify(pitches)}, height ${height}px (expected ${expected}px a line)`,
      );
    }
    // A layout-only page turn inside a paragraph: the block spacer adds exactly its height.
    const split = document.getElementById('split')!;
    const spacer = split.querySelector<HTMLElement>('.sp-paragraph-page-break')!;
    spacer.style.height = '0px';
    const without = split.getBoundingClientRect().height;
    spacer.style.height = '100px';
    const withGap = split.getBoundingClientRect().height;
    check(withGap - without === 100, `${name} split paragraph: page-turn spacer adds ${withGap - without}px (expected 100)`);
  }
  page.dataset.done = 'yes';
}

function fdxRoundTrip(): void {
  const doc = { type: 'doc', content: [
    { type: 'action', content: [{ type: 'text', text: 'Action.' }] },
    { type: 'character', content: [{ type: 'text', text: 'MARA' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'Hi.' }] },
  ] };
  const roundTrip = (tpl: FormattingTemplate) => {
    useFormattingTemplateStore.setState({ templates: [tpl], activeTemplateId: tpl.id });
    return parseFDXFull(exportFDX(doc, 'Measure')).lineSpacing;
  };
  const single = roundTrip(template(1));
  check(single === null, `fdx standard imports with no spacing (${JSON.stringify(single)})`);
  const open = roundTrip(template(1.25));
  check(JSON.stringify(open) === JSON.stringify({ lineSpacing: 1.25, lineHeightMultiplier: {} }),
    `fdx open (1.25) round trip: ${JSON.stringify(open)}`);
  const sitcom = roundTrip(template(1, true));
  check(JSON.stringify(sitcom) === JSON.stringify({ lineSpacing: 1, lineHeightMultiplier: { dialogue: 2 } }),
    `fdx sitcom round trip: ${JSON.stringify(sitcom)}`);
  useFormattingTemplateStore.setState({ templates: [], activeTemplateId: null });
}

document.fonts.ready.then(() => setTimeout(() => {
  try {
    out.push(`Courier Final Draft available: ${document.fonts.check("12pt 'Courier Final Draft'")}`);
    measure();
    fdxRoundTrip();
  } catch (err) {
    failures++;
    out.push(`FAIL threw: ${err instanceof Error ? err.stack : String(err)}`);
  }
  out.push(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
  document.getElementById('result')!.textContent = out.join('\n');
}, 200));
