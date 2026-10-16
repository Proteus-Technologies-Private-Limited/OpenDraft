/**
 * Golden output of every exporter, for a fixed set of scripts.
 *
 * Pins what PDF, FDX, DOCX, Fountain and OSF write today, so a change that is
 * meant to be additive — element numbering arrived this way — can show it left
 * every existing script's files exactly as they were. A diff in one of these
 * snapshots is a change in a file a writer would send out: update a snapshot
 * (`vitest run -u`) only when that change is the point of the commit.
 *
 * The PDF is pinned as the list of calls made on jsPDF, numbers rounded to a
 * hundredth of a point: the bytes carry a creation date, and the calls are
 * what decides what lands where on the page.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import JSZip from 'jszip';

// ── jsPDF, faked: log every call, answer the few that return something ──
const calls: string[] = [];

const fmt = (v: unknown): string => {
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(fmt).join(',')}]`;
  if (v && typeof v === 'object') {
    // Image data and font files are bulky and not what this test is about.
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}:${typeof x === 'string' && x.length > 64 ? `<${x.length} chars>` : fmt(x)}`)
      .join(',')}}`;
  }
  return String(v);
};

vi.mock('jspdf', () => {
  class FakeJsPDF {
    private font = 'courier';
    private style = 'normal';
    internal = { pages: [null, []] as unknown[] };
    constructor(opts: unknown) {
      calls.push(`new ${fmt(opts)}`);
      return new Proxy(this, {
        get(target, prop, receiver) {
          const own = Reflect.get(target, prop, receiver);
          if (typeof prop !== 'string' || prop === 'internal' || prop === 'then') return own;
          if (typeof own === 'function') {
            return (...args: unknown[]) => {
              calls.push(`${prop}(${args.map(fmt).join(', ')})`);
              return (own as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          if (own !== undefined) return own;
          // Anything else the exporter draws with: logged, returns nothing.
          return (...args: unknown[]) => { calls.push(`${prop}(${args.map(fmt).join(', ')})`); };
        },
      });
    }
    setFont(font: string, style?: string) { this.font = font; this.style = style ?? 'normal'; }
    getFont() { return { fontName: this.font, fontStyle: this.style }; }
    getTextWidth(text: string) { return 7.2 * text.length; }
    addPage() { this.internal.pages.push([]); }
    deletePage() { this.internal.pages.pop(); }
    output() { return new ArrayBuffer(0); }
  }
  return { default: FakeJsPDF, jsPDF: FakeJsPDF };
});

/** Captures the bytes `exportDocx` would have written to disk. */
const saved: { buf: Uint8Array | null } = { buf: null };
vi.mock('./fileOps', () => ({
  saveFile: (data: Uint8Array) => {
    saved.buf = data;
    return Promise.resolve(true);
  },
}));

const { renderPDF } = await import('./pdfExporter');
const { exportFDX } = await import('./fdxExporter');
const { exportDocx } = await import('./docxExporter');
const { exportFountain } = await import('./fountainExporter');
const { exportOSF } = await import('./osfExporter');
const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');
const { useFormattingTemplateStore } = await import('../stores/formattingTemplateStore');
const { INDUSTRY_STANDARD_ID } = await import('../stores/formattingTypes');
const { RADIO_PLAY_ID } = await import('../stores/templates/radioPlayTemplate');
const { MULTICAM_SITCOM_ID } = await import('../stores/templates/multicamSitcomTemplate');
const { AV_SCRIPT_ID } = await import('../stores/templates/avScriptTemplate');
const { doc, block } = await import('../test/screenplaySchema');

// ── Fixtures ─────────────────────────────────────────────────────────────

const LONG = 'I have been waiting for this moment for a very long time, and I am not going to let '
  + 'anyone take it away from me now, not after everything we have been through together. ';

const heading = (text: string, attrs: Record<string, unknown> = {}): JSONContent =>
  ({ type: 'sceneHeading', attrs, content: [{ type: 'text', text }] });
const custom = (id: string, label: string, text: string): JSONContent =>
  ({ type: 'customElement', attrs: { customTypeId: id, customLabel: label }, content: [{ type: 'text', text }] });
const speech = (who: string, ...lines: string[]): JSONContent[] =>
  [block('character', who), ...lines.map((l) => block('dialogue', l))];
const dual = (left: JSONContent[], right: JSONContent[]): JSONContent => ({
  type: 'dualDialogue',
  content: [{ type: 'dualDialogueColumn', content: left }, { type: 'dualDialogueColumn', content: right }],
});
const rev = (text: string): JSONContent =>
  ({ type: 'text', text, marks: [{ type: 'textStyle', attrs: { revision: 'Blue' } }] });

/** A run of scenes long enough to turn several pages and split a speech. */
function feature(scenes: number): JSONContent[] {
  const out: JSONContent[] = [];
  for (let s = 1; s <= scenes; s++) {
    out.push(heading(`INT. ROOM ${s} - DAY`, { sceneNumber: String(s) }));
    out.push(block('action', `Scene ${s} opens on a quiet room. Dust hangs in the light.`));
    out.push(...speech('MARA', 'Where were you?'));
    out.push(block('parenthetical', '(beat)'));
    out.push(block('dialogue', s % 3 === 0 ? LONG.repeat(4) : 'Never mind.'));
    out.push(...speech('JONAH', 'Out.'));
    if (s % 4 === 0) out.push(block('transition', 'CUT TO:'));
  }
  return out;
}

interface Fixture { name: string; templateId: string; doc: JSONContent; sceneNumbersVisible: boolean }

const FIXTURES: Fixture[] = [
  {
    name: 'feature',
    templateId: INDUSTRY_STANDARD_ID,
    sceneNumbersVisible: true,
    doc: doc(...feature(9)),
  },
  {
    name: 'feature-no-scene-numbers',
    templateId: INDUSTRY_STANDARD_ID,
    sceneNumbersVisible: false,
    doc: doc(...feature(4)),
  },
  {
    // A speech too long for one page: (MORE) at the foot, CONT'D at the head.
    name: 'split-speech',
    templateId: INDUSTRY_STANDARD_ID,
    sceneNumbersVisible: true,
    doc: doc(
      heading('INT. COURTROOM - DAY', { sceneNumber: '1' }),
      block('action', 'The room falls silent.'),
      ...speech('MARA', ...Array.from({ length: 12 }, () => LONG)),
      ...speech('JONAH', 'Objection.'),
    ),
  },
  {
    name: 'dual-dialogue',
    templateId: INDUSTRY_STANDARD_ID,
    sceneNumbersVisible: true,
    doc: doc(
      heading('EXT. STREET - NIGHT', { sceneNumber: '1' }),
      block('action', 'Two people talk over each other.'),
      dual(speech('MARA', 'We should go before it gets dark out there tonight.'),
        speech('JONAH', 'Not until the others are back.')),
      ...speech('MARA', 'Fine.'),
    ),
  },
  {
    name: 'revisions',
    templateId: INDUSTRY_STANDARD_ID,
    sceneNumbersVisible: true,
    doc: doc(
      heading('INT. OFFICE - DAY', { sceneNumber: '1' }),
      { type: 'action', content: [{ type: 'text', text: 'The phone rings. ' }, rev('Nobody answers it.')] },
      block('character', 'BOSS'),
      { type: 'dialogue', content: [rev('Somebody get that.')] },
    ),
  },
  {
    name: 'locked-omitted-scenes',
    templateId: INDUSTRY_STANDARD_ID,
    sceneNumbersVisible: true,
    doc: doc(
      heading('INT. HALL - DAY', { sceneNumber: '1' }),
      block('action', 'A long corridor.'),
      heading('OMITTED', { sceneNumber: '2', omitted: true }),
      heading('INT. HALL - LATER', { sceneNumber: '2A' }),
      ...speech('MARA', 'Again.'),
      heading('INT. STAIRS - DAY', { sceneNumber: '3' }),
      block('action', 'Footsteps.'),
    ),
  },
  {
    name: 'radio-play',
    templateId: RADIO_PLAY_ID,
    sceneNumbersVisible: true,
    doc: doc(
      heading('SCENE 1', { sceneNumber: '1' }),
      custom('soundEffect', 'Sound Effect', 'SFX: WAVES CRASHING ON A ROCKY SHORE.'),
      custom('musicCue', 'Music Cue', 'MUSIC: SLOW STRINGS, SOMBER.'),
      ...speech('NARRATOR', 'On a cold morning in October...'),
      ...speech('MARA', 'Who is there?'),
      custom('soundEffect', 'Sound Effect', 'SFX: A DOOR CREAKS.'),
      heading('SCENE 2', { sceneNumber: '2' }),
      ...speech('JONAH', 'Only me.'),
    ),
  },
  {
    name: 'multicam-sitcom',
    templateId: MULTICAM_SITCOM_ID,
    sceneNumbersVisible: true,
    doc: doc(
      block('newAct', 'ACT ONE'),
      heading('INT. KITCHEN - DAY', { sceneNumber: 'A' }),
      block('action', 'Mara burns the toast.'),
      ...speech('MARA', 'Nobody saw that.'),
      ...speech('JONAH', 'Everybody saw that.'),
      block('endOfAct', 'END OF ACT ONE'),
    ),
  },
  {
    name: 'av-script',
    templateId: AV_SCRIPT_ID,
    sceneNumbersVisible: false,
    doc: doc(
      block('action', 'Opening.'),
      {
        type: 'avBlock',
        content: [1, 2].map((n) => ({
          type: 'avRow',
          attrs: { duration: '0:05', shot: null, start: null },
          content: [
            { type: 'avCell', attrs: { side: 'video' }, content: [{ type: 'avPara', content: [{ type: 'text', text: `Wide shot ${n}.` }] }] },
            { type: 'avCell', attrs: { side: 'audio' }, content: [{ type: 'avPara', content: [{ type: 'text', text: `Narration ${n}.` }] }] },
          ],
        })),
      },
    ),
  },
];

// ── Runners ──────────────────────────────────────────────────────────────

const SNAP = (fixture: string, ext: string) => `./__snapshots__/exportGolden/${fixture}.${ext}`;

async function docxXml(d: JSONContent): Promise<string> {
  await exportDocx(d, 'Golden', DEFAULT_PAGE_LAYOUT);
  const bytes = saved.buf;
  if (!bytes) throw new Error('exportDocx wrote nothing');
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('docx has no word/document.xml');
  // One element per line, so a snapshot diff points at the paragraph that moved.
  return xml.replace(/></g, '>\n<');
}

beforeEach(() => {
  calls.length = 0;
  saved.buf = null;
});

describe.each(FIXTURES)('golden export: $name', (f) => {
  beforeEach(() => {
    useFormattingTemplateStore.setState({ activeTemplateId: f.templateId });
  });

  it('PDF', async () => {
    await renderPDF(f.doc, 'Golden', DEFAULT_PAGE_LAYOUT, { sceneNumbersVisible: f.sceneNumbersVisible });
    await expect(calls.join('\n') + '\n').toMatchFileSnapshot(SNAP(f.name, 'pdf.txt'));
  });

  it('FDX', async () => {
    const out = exportFDX(f.doc, 'Golden', undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, { sceneNumbersVisible: f.sceneNumbersVisible });
    await expect(out).toMatchFileSnapshot(SNAP(f.name, 'fdx'));
  });

  it('DOCX', async () => {
    await expect(await docxXml(f.doc)).toMatchFileSnapshot(SNAP(f.name, 'docx.xml'));
  });

  it('Fountain', async () => {
    const out = exportFountain(f.doc, { sceneNumbersVisible: f.sceneNumbersVisible });
    await expect(out).toMatchFileSnapshot(SNAP(f.name, 'fountain'));
  });

  it('OSF', async () => {
    const out = exportOSF(f.doc, { sceneNumbers: { visible: f.sceneNumbersVisible, locked: false } });
    await expect(out).toMatchFileSnapshot(SNAP(f.name, 'osf'));
  });
});

// ── Numbering on ─────────────────────────────────────────────────────────
//
// The same promise from the other side: turning element numbers on adds the
// numbers and moves nothing else. Every line of the script lands on the same
// page at the same place, and a split speech is still split where it was.

const { PODCAST_ID } = await import('../stores/templates/podcastTemplate');
const { withElementNumbers, getElementNumberingRules } = await import('./elementNumbers');
const { DOMParser: XmldomDOMParser } = await import('@xmldom/xmldom');

const podcast: JSONContent = doc(
  heading('SCENE 1', { sceneNumber: '1' }),
  custom('soundEffect', 'Sound Effect', 'SFX: RAIN ON A TIN ROOF.'),
  ...speech('HOST', 'Welcome back. Tonight, a story about a lighthouse.'),
  custom('musicCue', 'Music Cue', 'MUSIC: THEME IN, THEN UNDER.'),
  ...speech('KEEPER', ...Array.from({ length: 12 }, () => LONG)),
  dual(speech('HOST', 'Then why are we here?'), speech('KEEPER', 'Because someone just did.')),
  block('character', 'HOST'),
  { type: 'dialogue', content: [{ type: 'text', text: 'Listen. ' }, rev('Footsteps.')] },
  heading('SCENE 2', { sceneNumber: '2' }),
  custom('soundEffect', 'Sound Effect', 'SFX: A DOOR SLAMS.'),
  ...speech('KEEPER', 'Run.'),
);

/** Every numbered paragraph's label, in order, as the exporters are given them. */
function podcastLabels(): string[] {
  const out: string[] = [];
  const walk = (nodes: JSONContent[] | undefined) => {
    for (const n of nodes ?? []) {
      const v = n.attrs?.elementNumber;
      if (typeof v === 'string') out.push(v);
      walk(n.content);
    }
  };
  walk(withElementNumbers(podcast, { visible: true, sceneNumbersVisible: true }).content);
  return out;
}

async function pdfCalls(d: JSONContent, elementNumbersVisible: boolean): Promise<string[]> {
  calls.length = 0;
  await renderPDF(d, 'Golden', DEFAULT_PAGE_LAYOUT, { sceneNumbersVisible: true, elementNumbersVisible });
  return [...calls];
}

describe('golden export: podcast, numbering on', () => {
  beforeEach(() => {
    useFormattingTemplateStore.setState({ activeTemplateId: PODCAST_ID });
  });

  it('numbers dialogue through the script, and FX and MX cues on their own', () => {
    expect(podcastLabels()).toEqual([
      'FX 1', '1', 'MX 1',
      ...Array.from({ length: 12 }, (_v, k) => String(k + 2)),
      '14', '15', '16', 'FX 2', '17',
    ]);
  });

  it('PDF: every line lands exactly where it did without numbers', async () => {
    const off = await pdfCalls(podcast, false);
    const on = await pdfCalls(podcast, true);
    const layout = (cs: string[]) => cs.filter((c) => c.startsWith('text(') || c.startsWith('addPage'));
    // The output without numbers must appear, call for call and in order,
    // inside the output with them; whatever is left over is the numbers.
    const extra: string[] = [];
    const base = layout(off);
    let k = 0;
    for (const c of layout(on)) {
      if (k < base.length && c === base[k]) k++;
      else extra.push(c);
    }
    expect(k).toBe(base.length);
    const drawn = extra.map((c) => JSON.parse(/^text\(("(?:[^"\\]|\\.)*")/.exec(c)?.[1] ?? 'null'));
    // One label per numbered paragraph, in order — a speech split over the
    // page is not numbered twice.
    expect(drawn).toEqual(podcastLabels());
    expect(on.join('\n')).toContain('(MORE)');
    await expect(on.join('\n') + '\n').toMatchFileSnapshot(SNAP('podcast-numbered', 'pdf.txt'));
  });

  it('PDF: hiding the numbers gives the very same output as a format without them', async () => {
    const hidden = await pdfCalls(podcast, false);
    useFormattingTemplateStore.setState({ activeTemplateId: RADIO_PLAY_ID });
    const radio = await pdfCalls(podcast, true);
    expect(hidden).toEqual(radio);
  });

  it('FDX: each numbered paragraph carries its number, and the file stays well-formed', async () => {
    // A dialogue line still holding a number Final Draft gave it, as a script
    // imported but never opened can: it must not end up with two.
    const stray = JSON.parse(JSON.stringify(podcast)) as JSONContent;
    const firstDialogue = stray.content!.find((n) => n.type === 'dialogue')!;
    firstDialogue.attrs = { ...(firstDialogue.attrs ?? {}), sceneNumber: '99' };
    const out = exportFDX(stray, 'Golden', undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, { sceneNumbersVisible: true, elementNumbersVisible: true });
    const errors: string[] = [];
    const xml = new XmldomDOMParser({ onError: (level: string, msg: string) => { if (level !== 'warning') errors.push(msg); } })
      .parseFromString(out, 'text/xml');
    expect(errors).toEqual([]);
    const numbers = Array.from(xml.getElementsByTagName('Paragraph'))
      .map((p) => p.getAttribute('Number'))
      .filter((n): n is string => !!n);
    expect(numbers).toEqual(['1', ...podcastLabels().slice(0, -2), '2', ...podcastLabels().slice(-2)]);
    expect(out).not.toContain('Number="99"');
    for (const line of out.split('\n')) expect((line.match(/ Number="/g) ?? []).length).toBeLessThanOrEqual(1);
    await expect(out).toMatchFileSnapshot(SNAP('podcast-numbered', 'fdx'));
  });

  it('DOCX: numbered paragraphs hang their number; every other paragraph is untouched', async () => {
    await exportDocx(podcast, 'Golden', DEFAULT_PAGE_LAYOUT);
    const offXml = await docxXmlFromSaved();
    await exportDocx(podcast, 'Golden', DEFAULT_PAGE_LAYOUT, { elementNumbersVisible: true, sceneNumbersVisible: true });
    const onXml = await docxXmlFromSaved();
    const paras = (xml: string) => xml.split('<w:p>').slice(1);
    const on = paras(onXml);
    const off = paras(offXml);
    expect(on).toHaveLength(off.length);
    const numbered = on.filter((p) => p.includes('w:hanging='));
    // Dual dialogue is not written to Word at all yet, so its two lines are absent here.
    expect(numbered).toHaveLength(podcastLabels().length - 2);
    on.forEach((p, k) => { if (!p.includes('w:hanging=')) expect(p).toBe(off[k]); });
    await expect(onXml).toMatchFileSnapshot(SNAP('podcast-numbered', 'docx.xml'));
  });

  it('reads the rules from the active format', () => {
    expect(Object.keys(getElementNumberingRules()).sort()).toEqual(['dialogue', 'musicCue', 'soundEffect']);
    useFormattingTemplateStore.setState({ activeTemplateId: RADIO_PLAY_ID });
    expect(getElementNumberingRules()).toEqual({});
  });
});

async function docxXmlFromSaved(): Promise<string> {
  const bytes = saved.buf;
  if (!bytes) throw new Error('exportDocx wrote nothing');
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('docx has no word/document.xml');
  return xml.replace(/></g, '>\n<');
}
