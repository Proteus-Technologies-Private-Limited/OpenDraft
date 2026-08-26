// Final Draft XML (.fdx) exporter — full formatting & layout support
import type { JSONContent } from '@tiptap/react';
import type { CharacterProfile, TagCategory, TagItem, BeatInfo, BeatColumn, PageLayout } from '../stores/editorStore';
import { resolveHeaderFooter } from '../stores/editorStore';
import { CUSTOM_TYPE_TO_FDX } from './fdxParser';
import { jsonBlockText } from './nodeText';
import { sanitizeExportFilename } from './exportFilename';
import { isNonPrintingType } from './nonPrinting';

const NODE_TO_FDX: Record<string, string> = {
  sceneHeading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
  general: 'General',
  shot: 'Shot',
  newAct: 'New Act',
  endOfAct: 'End of Act',
  lyrics: 'Lyrics',
  showEpisode: 'Show/Episode',
  castList: 'Cast List',
};

/** Resolve the FDX paragraph Type for a Tiptap node.
 *  customElement nodes use their customTypeId to look up an FDX-equivalent name. */
function resolveFdxExportType(node: JSONContent): string {
  if (node.type === 'customElement') {
    const cid = (node.attrs as { customTypeId?: string } | undefined)?.customTypeId;
    if (cid && CUSTOM_TYPE_TO_FDX[cid]) return CUSTOM_TYPE_TO_FDX[cid];
    return 'General';
  }
  return NODE_TO_FDX[node.type || ''] || 'General';
}

const ALIGNMENT_TO_FDX: Record<string, string> = {
  left: 'Left', center: 'Center', right: 'Right', justify: 'Justify',
};

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // A newline inside <Text> is how an in-paragraph line break is carried.
    // Encoding it as a numeric entity keeps it intact through XML
    // pretty-printers and whitespace-normalizing readers, which would
    // otherwise collapse a raw newline to a space and lose the break.
    .replace(/\r\n?|\n/g, '&#10;');
}

/**
 * Build the `<HeaderAndFooter>` block from the document's own settings.
 *
 * Final Draft carries the dynamic fields as `<DynamicLabel>` elements rather
 * than literal text, so a template is split on the tokens OpenDraft shares with
 * it; `{revision}` has no FDX equivalent and goes out as the resolved text.
 */
const FDX_DYNAMIC_LABEL: Record<string, string> = {
  '{page}': 'Page #',
  '{pages}': 'Last Page #',
  '{title}': 'Title',
  '{date}': 'Date',
};

function buildHFParagraph(
  template: string,
  alignment: 'Left' | 'Center' | 'Right',
  docFont: string,
  docFontSize: string,
): string[] {
  if (!template) return [];
  const out: string[] = [];
  out.push(`      <Paragraph Alignment="${alignment}" FirstIndent="0.00" Leading="Regular" LeftIndent="1.25" RightIndent="-1.00" SpaceBefore="0" Spacing="1" StartsNewPage="No">`);
  const textRun = (s: string) => {
    if (!s) return;
    out.push(`        <Text AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(docFont)}" RevisionID="0" Size="${esc(docFontSize)}" Style="">${esc(s)}</Text>`);
  };
  const tokenRe = /(\{page\}|\{pages\}|\{title\}|\{date\}|\{revision\})/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(template)) !== null) {
    textRun(template.slice(last, m.index));
    const label = FDX_DYNAMIC_LABEL[m[0].toLowerCase()];
    // {revision} has no Final Draft counterpart; drop the token rather than
    // writing a label Final Draft would reject.
    if (label) out.push(`        <DynamicLabel Type="${label}"/>`);
    last = tokenRe.lastIndex;
  }
  textRun(template.slice(last));
  out.push('      </Paragraph>');
  return out;
}

function buildHeaderAndFooter(
  pageLayout: PageLayout | undefined,
  docFont: string,
  docFontSize: string,
): string[] {
  const hf = resolveHeaderFooter(pageLayout);
  const hasContent = (c: { left: string; center: string; right: string }) =>
    !!(c.left || c.center || c.right);
  const headerVisible = hasContent(hf.headerContent);
  const footerVisible = hasContent(hf.footerContent);
  // Final Draft's first-page flags are relative to the printed number the
  // script's opening page carries, the same comparison every OpenDraft
  // consumer makes.
  const first = hf.startingPageNumber;
  const yn = (b: boolean) => (b ? 'Yes' : 'No');

  const out: string[] = [];
  out.push(
    `  <HeaderAndFooter FooterFirstPage="${yn(hf.footerStartPage <= first)}"`
    + ` FooterVisible="${yn(footerVisible)}"`
    + ` HeaderFirstPage="${yn(hf.headerStartPage <= first)}"`
    + ` HeaderVisible="${yn(headerVisible)}"`
    + ` StartingPage="${hf.startingPageNumber}">`,
  );
  if (headerVisible) {
    out.push('    <Header>');
    out.push(...buildHFParagraph(hf.headerContent.left, 'Left', docFont, docFontSize));
    out.push(...buildHFParagraph(hf.headerContent.center, 'Center', docFont, docFontSize));
    out.push(...buildHFParagraph(hf.headerContent.right, 'Right', docFont, docFontSize));
    out.push('    </Header>');
  }
  if (footerVisible) {
    out.push('    <Footer>');
    out.push(...buildHFParagraph(hf.footerContent.left, 'Left', docFont, docFontSize));
    out.push(...buildHFParagraph(hf.footerContent.center, 'Center', docFont, docFontSize));
    out.push(...buildHFParagraph(hf.footerContent.right, 'Right', docFont, docFontSize));
    out.push('    </Footer>');
  }
  out.push('  </HeaderAndFooter>');
  return out;
}

/** Strip HTML tags to plain text (for FDX export — CastMember Description is plain text only) */
function stripHtml(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

/**
 * Generate ElementSettings using the document's actual margins and typeface.
 * FDX indents are absolute positions (inches from left page edge).
 * We shift all element indents relative to the Action baseline.
 *
 * The font goes on every element's FontSpec, which is where Final Draft keeps
 * a script's typeface — writing it only on the runs would leave the file
 * claiming Courier while its text says otherwise.
 */
function buildElementSettings(lm: number, ri: number, font: string, size: string): string {
  // lm = left margin (Action LeftIndent), ri = Action RightIndent
  const f = (n: number) => n.toFixed(2);
  // Offsets from the standard Action indent (1.25/7.25) for each element type
  const character_l = lm + 2.50, parenthetical_l = lm + 2.00, dialogue_l = lm + 1.31;
  const transition_l = lm + 4.00, castList_l = lm + 0.25, outline2_l = lm + 0.50;
  const dialogue_r = ri - 1.00, parenthetical_r = ri - 2.00, transition_r = ri - 0.50;
  const castList_r = ri + 0.25;

  return `
  <ElementSettings Type="Scene Heading">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style="AllCaps"/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(lm)}" RightIndent="${f(ri)}" SpaceBefore="24" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="Scene Heading" ReturnKey="Action" Shortcut="1"/>
  </ElementSettings>
  <ElementSettings Type="Action">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style=""/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(lm)}" RightIndent="${f(ri)}" SpaceBefore="12" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="Action" ReturnKey="Action" Shortcut="2"/>
  </ElementSettings>
  <ElementSettings Type="Character">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style="AllCaps"/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(character_l)}" RightIndent="${f(ri)}" SpaceBefore="12" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="Character" ReturnKey="Dialogue" Shortcut="3"/>
  </ElementSettings>
  <ElementSettings Type="Parenthetical">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style=""/>
    <ParagraphSpec Alignment="Left" FirstIndent="-0.10" Leading="Regular" LeftIndent="${f(parenthetical_l)}" RightIndent="${f(parenthetical_r)}" SpaceBefore="0" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="Parenthetical" ReturnKey="Dialogue" Shortcut="4"/>
  </ElementSettings>
  <ElementSettings Type="Dialogue">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style=""/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(dialogue_l)}" RightIndent="${f(dialogue_r)}" SpaceBefore="0" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="Dialogue" ReturnKey="Action" Shortcut="5"/>
  </ElementSettings>
  <ElementSettings Type="Transition">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style="AllCaps"/>
    <ParagraphSpec Alignment="Right" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(transition_l)}" RightIndent="${f(transition_r)}" SpaceBefore="12" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="Transition" ReturnKey="Scene Heading" Shortcut="6"/>
  </ElementSettings>
  <ElementSettings Type="Shot">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style="AllCaps"/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(lm)}" RightIndent="${f(ri)}" SpaceBefore="12" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="Scene Heading" ReturnKey="Action" Shortcut="7"/>
  </ElementSettings>
  <ElementSettings Type="General">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style=""/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(lm)}" RightIndent="${f(ri)}" SpaceBefore="0" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="General" ReturnKey="General" Shortcut="0"/>
  </ElementSettings>
  <ElementSettings Type="Cast List">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style="AllCaps"/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(castList_l)}" RightIndent="${f(castList_r)}" SpaceBefore="0" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="Action" ReturnKey="Action" Shortcut="8"/>
  </ElementSettings>
  <ElementSettings Type="Lyrics">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style="Italic"/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(dialogue_l)}" RightIndent="${f(dialogue_r)}" SpaceBefore="0" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="Dialogue" ReturnKey="Action" Shortcut="0"/>
  </ElementSettings>
  <ElementSettings Type="New Act">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style="Bold+Underline+AllCaps"/>
    <ParagraphSpec Alignment="Center" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(lm)}" RightIndent="${f(ri)}" SpaceBefore="24" Spacing="1" StartsNewPage="Yes"/>
    <Behavior PaginateAs="Action" ReturnKey="Scene Heading" Shortcut="0"/>
  </ElementSettings>
  <ElementSettings Type="End of Act">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style="Bold+AllCaps"/>
    <ParagraphSpec Alignment="Center" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(lm)}" RightIndent="${f(ri)}" SpaceBefore="24" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="Action" ReturnKey="New Act" Shortcut="0"/>
  </ElementSettings>
  <ElementSettings Type="Show/Episode">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style="Bold+AllCaps"/>
    <ParagraphSpec Alignment="Center" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(lm)}" RightIndent="${f(ri)}" SpaceBefore="12" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="Action" ReturnKey="Action" Shortcut="0"/>
  </ElementSettings>
  <ElementSettings Type="Outline 1">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style="Bold+AllCaps"/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(lm)}" RightIndent="${f(ri)}" SpaceBefore="24" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="Action" ReturnKey="Outline Body" Shortcut="0"/>
  </ElementSettings>
  <ElementSettings Type="Outline 2">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style="Bold"/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(outline2_l)}" RightIndent="${f(ri)}" SpaceBefore="12" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="Action" ReturnKey="Outline Body" Shortcut="0"/>
  </ElementSettings>
  <ElementSettings Type="Outline Body">
    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${esc(font)}" RevisionID="0" Size="${esc(size)}" Style=""/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" Leading="Regular" LeftIndent="${f(lm)}" RightIndent="${f(ri)}" SpaceBefore="0" Spacing="1" StartsNewPage="No"/>
    <Behavior PaginateAs="Action" ReturnKey="Action" Shortcut="0"/>
  </ElementSettings>`;
}

interface MarkInfo { type: string; attrs?: Record<string, unknown>; }

function getTextAttributes(marks?: MarkInfo[]): string {
  if (!marks || marks.length === 0) return '';
  const parts: string[] = [];
  const styles: string[] = [];
  let fontName = '', fontSize = '', fontColor = '';

  for (const mark of marks) {
    if (mark.type === 'bold') styles.push('Bold');
    if (mark.type === 'italic') styles.push('Italic');
    if (mark.type === 'underline') styles.push('Underline');
    if (mark.type === 'textStyle' && mark.attrs) {
      if (mark.attrs.fontFamily) fontName = String(mark.attrs.fontFamily);
      if (mark.attrs.fontSize) fontSize = String(mark.attrs.fontSize).replace('pt', '');
      if (mark.attrs.color) fontColor = String(mark.attrs.color);
    }
  }

  if (styles.length > 0) parts.push(`Style="${styles.join('+')}"`);
  if (fontName) parts.push(`Font="${esc(fontName)}"`);
  if (fontSize) parts.push(`Size="${esc(fontSize)}"`);
  if (fontColor) parts.push(`Color="${esc(fontColor)}"`);

  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

/** The typeface a script is written in, for the element settings. */
export interface FDXDocumentFont {
  family?: string;
  size?: number;
}

export function exportFDX(doc: JSONContent, title: string = 'Untitled', characterProfiles?: CharacterProfile[], tagCategories?: TagCategory[], tags?: TagItem[], beats?: BeatInfo[], beatColumns?: BeatColumn[], pageLayout?: PageLayout, documentFont?: FDXDocumentFont): string {
  // Final Draft keeps the typeface on each element's FontSpec; the screenplay
  // Courier is the default a file gets when the writer has not changed it.
  const docFont = documentFont?.family || 'Courier Prime';
  const docFontSize = String(documentFont?.size ?? 12);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>');
  lines.push('<FinalDraft DocumentType="Script" Template="No" Version="5">');
  lines.push('');

  // Page layout — use the editor's current layout for lossless round-trip
  const pw = pageLayout?.pageWidth?.toFixed(2) ?? '8.50';
  const ph = pageLayout?.pageHeight?.toFixed(2) ?? '11.00';
  const tm = pageLayout?.topMargin ?? 90;
  const bm = pageLayout?.bottomMargin ?? 62;
  const hm = pageLayout?.headerMargin ?? 36;
  const fm = pageLayout?.footerMargin ?? 36;
  lines.push(`  <PageLayout BackgroundColor="#FFFFFFFFFFFF" BottomMargin="${bm}" BreakDialogueAndActionAtSentences="Yes" DocumentLeading="Normal" FooterMargin="${fm}" ForegroundColor="#000000000000" HeaderMargin="${hm}" InvisiblesColor="#808080808080" TopMargin="${tm}" UsesSmartQuotes="No">`);
  lines.push(`    <PageSize Height="${ph}" Width="${pw}"/>`);
  lines.push('  </PageLayout>');
  lines.push('');

  // Element settings — use actual margins so re-import round-trips correctly
  const leftIndent = pageLayout?.leftMargin ?? 1.25;
  const rightIndent = pageLayout ? (pageLayout.pageWidth - pageLayout.rightMargin) : 7.25;
  lines.push(buildElementSettings(leftIndent, rightIndent, docFont, docFontSize));
  lines.push('');

  // Header and footer — the document's own settings, not a fixed page number.
  // Final Draft models each band as aligned paragraphs plus attributes for
  // first-page visibility and the starting number, which is close enough to
  // OpenDraft's model to carry across without loss.
  lines.push(...buildHeaderAndFooter(pageLayout, docFont, docFontSize));
  lines.push('');

  // Title page — extract structured attrs from titlePage nodes if available
  lines.push('  <TitlePage>');
  lines.push('    <Content>');
  let tpTitle = title;
  let tpWrittenBy = '';
  let tpBasedOn = '';
  let tpDraft = '';
  let tpContact = '';
  let tpCopyright = '';
  if (doc.content) {
    for (const node of doc.content) {
      if (node.type === 'titlePage' && node.attrs?.field === 'title' && node.attrs?.tpTitle) {
        tpTitle = node.attrs.tpTitle || title;
        tpWrittenBy = node.attrs.tpWrittenBy || '';
        tpBasedOn = node.attrs.tpBasedOn || '';
        tpDraft = [node.attrs.tpDraft, node.attrs.tpDraftDate].filter(Boolean).join(' - ');
        tpContact = node.attrs.tpContact || '';
        tpCopyright = node.attrs.tpCopyright || '';
        break;
      }
    }
  }
  lines.push(`      <Paragraph Type="General" Alignment="Center" SpaceBefore="288"><Text>${esc(tpTitle)}</Text></Paragraph>`);
  if (tpWrittenBy) {
    lines.push(`      <Paragraph Type="General" Alignment="Center"><Text>Written by</Text></Paragraph>`);
    lines.push(`      <Paragraph Type="General" Alignment="Center"><Text>${esc(tpWrittenBy)}</Text></Paragraph>`);
    if (tpBasedOn) {
      lines.push(`      <Paragraph Type="General" Alignment="Center"><Text>${esc(tpBasedOn)}</Text></Paragraph>`);
    }
  }
  if (tpDraft) {
    lines.push(`      <Paragraph Type="General"><Text>${esc(tpDraft)}</Text></Paragraph>`);
  }
  if (tpContact) {
    for (const line of tpContact.split('\n')) {
      lines.push(`      <Paragraph Type="General" Alignment="Right"><Text>${esc(line)}</Text></Paragraph>`);
    }
  }
  if (tpCopyright) {
    lines.push(`      <Paragraph Type="General"><Text>${esc(tpCopyright)}</Text></Paragraph>`);
  }
  lines.push('    </Content>');
  lines.push('  </TitlePage>');
  lines.push('');

  // Script content — write all beats as Outline paragraphs before the script body
  lines.push('  <Content>');

  // Write beats grouped by column, in column order
  if (beats && beats.length > 0) {
    const sortedCols = beatColumns
      ? [...beatColumns].sort((a, b) => a.position - b.position)
      : [];
    const colIds = new Set(sortedCols.map((c) => c.id));
    // Group beats by columnId
    const beatsByCol = new Map<string, BeatInfo[]>();
    for (const beat of [...beats].sort((a, b) => a.position - b.position)) {
      const arr = beatsByCol.get(beat.columnId) || [];
      arr.push(beat);
      beatsByCol.set(beat.columnId, arr);
    }
    // Write column-by-column
    for (const col of sortedCols) {
      const colBeats = beatsByCol.get(col.id);
      if (!colBeats || colBeats.length === 0) continue;
      // Column header as Outline 1 section marker
      lines.push(`    <Paragraph Type="Outline 1"><Text>${esc(col.title)}</Text></Paragraph>`);
      for (const beat of colBeats) {
        lines.push(`    <Paragraph Type="Outline 2"><Text>${esc(beat.title)}</Text></Paragraph>`);
        if (beat.description) {
          for (const descLine of beat.description.split('\n')) {
            lines.push(`    <Paragraph Type="Outline Body"><Text>${esc(descLine)}</Text></Paragraph>`);
          }
        }
      }
    }
    // Beats in unknown columns (orphaned)
    for (const [colId, colBeats] of beatsByCol) {
      if (colIds.has(colId)) continue;
      for (const beat of colBeats) {
        lines.push(`    <Paragraph Type="Outline 1"><Text>${esc(beat.title)}</Text></Paragraph>`);
        if (beat.description) {
          for (const descLine of beat.description.split('\n')) {
            lines.push(`    <Paragraph Type="Outline Body"><Text>${esc(descLine)}</Text></Paragraph>`);
          }
        }
      }
    }
  }

  // Helper: emit a single Paragraph element
  const emitParagraph = (node: JSONContent, indent: string) => {
    const fdxType = resolveFdxExportType(node);
    const paraAttrs: string[] = [`Type="${fdxType}"`];

    if (node.attrs?.sceneNumber) paraAttrs.push(`Number="${node.attrs.sceneNumber}"`);
    if (node.attrs?.textAlign) {
      const a = ALIGNMENT_TO_FDX[node.attrs.textAlign as string];
      if (a) paraAttrs.push(`Alignment="${a}"`);
    }
    if (node.attrs?.startsNewPage) paraAttrs.push('StartsNewPage="Yes"');

    const attrStr = paraAttrs.join(' ');

    if (node.content && node.content.length > 0) {
      lines.push(`${indent}<Paragraph ${attrStr}>`);
      // Scene heading synopsis → SceneProperties/Summary (Final Draft format)
      if (node.type === 'sceneHeading' && node.attrs?.synopsis) {
        lines.push(`${indent}  <SceneProperties>`);
        lines.push(`${indent}    <Summary>`);
        lines.push(`${indent}      <Paragraph>`);
        lines.push(`${indent}        <Text>${esc(String(node.attrs.synopsis))}</Text>`);
        lines.push(`${indent}      </Paragraph>`);
        lines.push(`${indent}    </Summary>`);
        lines.push(`${indent}  </SceneProperties>`);
      }
      // A Character paragraph must stay on one line — a break there would
      // read as a second, phantom speaker. Collapse rather than encode.
      const collapseBreaks = fdxType === 'Character';
      for (const child of node.content) {
        if (child.type === 'hardBreak') {
          if (!collapseBreaks) {
            // A standalone Text run holding just the break, so the encoding
            // is unambiguous and the neighbouring runs keep their own styling.
            lines.push(`${indent}  <Text>&#10;</Text>`);
          } else if (lines[lines.length - 1]?.includes('<Text')) {
            lines.push(`${indent}  <Text> </Text>`);
          }
        } else if (child.type === 'text' && child.text) {
          const ta = getTextAttributes(child.marks as MarkInfo[] | undefined);
          lines.push(`${indent}  <Text${ta}>${esc(child.text)}</Text>`);
        }
      }
      lines.push(`${indent}</Paragraph>`);
    } else {
      lines.push(`${indent}<Paragraph ${attrStr}><Text></Text></Paragraph>`);
    }
  };

  if (doc.content) {
    for (const node of doc.content) {
      // FDX has no representation for inserted images — skip them.
      // Fountain's non-printing structure has no Final Draft equivalent that
      // stays off the page — a Paragraph of any type prints — so it is left out
      // rather than smuggled in as Action.
      if (isNonPrintingType(node.type)) continue;
      if (node.type === 'screenplayImage') continue;
      // The title page has already been written to <TitlePage><Content>, which
      // is where Final Draft looks for it. Emitting these here as well put the
      // title, credit and copyright at the top of the script body — reopening
      // the exported file showed the title page on script page 1, which is the
      // very thing issue #52 is about.
      if (node.type === 'titlePage') continue;
      if (node.type === 'dualDialogue') {
        // Wrap in DualDialogue element — flatten columns into paragraphs
        lines.push('    <DualDialogue>');
        if (node.content) {
          for (const col of node.content) {
            if (col.type === 'dualDialogueColumn' && col.content) {
              for (const child of col.content) {
                emitParagraph(child, '      ');
              }
            }
          }
        }
        lines.push('    </DualDialogue>');
      } else if (node.type === 'avBlock') {
        // AV block: emit each row as a pair of General paragraphs with custom attrs.
        // FDX-aware OpenDraft instances re-import this back into avBlock; Final Draft
        // sees a flat sequence of General paragraphs (acceptable degradation).
        if (node.content) {
          let rowIdx = 0;
          for (const row of node.content) {
            if (row.type !== 'avRow' || !row.content) continue;
            const rowId = `r${rowIdx++}`;
            for (const cell of row.content) {
              if (cell.type !== 'avCell' || !cell.content) continue;
              const side = (cell.attrs as { side?: string } | undefined)?.side || 'video';
              for (const para of cell.content) {
                // Hard breaks come through as newlines, which esc() encodes as
                // &#10; — the same in-paragraph break encoding used above.
                const text = jsonBlockText(para);
                lines.push(`    <Paragraph Type="General" data-av-side="${esc(side)}" data-av-row-id="${esc(rowId)}"><Text>${esc(text)}</Text></Paragraph>`);
              }
            }
          }
        }
      } else {
        emitParagraph(node, '    ');
      }
    }
  }

  lines.push('  </Content>');

  // CastList (Final Draft character descriptions)
  if (characterProfiles && characterProfiles.length > 0) {
    lines.push('');
    lines.push('  <CastList>');
    for (const p of characterProfiles) {
      const plainDesc = stripHtml(p.description);
      if (plainDesc) {
        lines.push(`    <CastMember>`);
        lines.push(`      <Name>${esc(p.name)}</Name>`);
        lines.push(`      <Description>${esc(plainDesc)}</Description>`);
        lines.push(`    </CastMember>`);
      }
    }
    lines.push('  </CastList>');

    // CharacterHighlighting
    lines.push('');
    lines.push('  <CharacterHighlighting>');
    for (const p of characterProfiles) {
      if (p.color) {
        lines.push(`    <Character Name="${esc(p.name)}" Color="${esc(p.color)}" Highlighted="${p.highlighted ? 'Yes' : 'No'}"/>`);
      }
    }
    lines.push('  </CharacterHighlighting>');
  }

  // TagData (production breakdown tags)
  if (tagCategories && tags && tags.length > 0) {
    const usedCatIds = new Set(tags.map((t) => t.categoryId));
    const usedCats = tagCategories.filter((c) => usedCatIds.has(c.id));

    lines.push('');
    lines.push('  <TagData>');
    lines.push('    <TagCategories>');
    for (const cat of usedCats) {
      lines.push(`      <TagCategory CatId="${esc(cat.id)}" Name="${esc(cat.name)}" Color="${esc(cat.color)}"/>`);
    }
    lines.push('    </TagCategories>');
    lines.push('    <TagItems>');
    for (const tag of tags) {
      lines.push(`      <TagItem TagId="${esc(tag.id)}" CatId="${esc(tag.categoryId)}" Label="${esc(tag.name || tag.text)}"/>`);
    }
    lines.push('    </TagItems>');
    lines.push('  </TagData>');
  }

  // DisplayBoards — Beat Board canvas metadata
  if (beats && beats.length > 0) {
    lines.push('');
    lines.push('  <DisplayBoards>');
    lines.push('    <DisplayBoard Height="55" ScrollOrigin="0,0" Type="StoryMap" Width="2032" ZoomLevel="100.000"/>');
    lines.push('    <DisplayBoard Height="10000" ScrollOrigin="0,0" Type="Beat" Width="24000" ZoomLevel="100.000"/>');
    lines.push('  </DisplayBoards>');
  }

  lines.push('</FinalDraft>');

  return lines.join('\n');
}

export async function downloadFDX(doc: JSONContent, title: string = 'Untitled', characterProfiles?: CharacterProfile[], tagCategories?: TagCategory[], tags?: TagItem[], beats?: BeatInfo[], beatColumns?: BeatColumn[], pageLayout?: PageLayout, documentFont?: FDXDocumentFont) {
  const xml = exportFDX(doc, title, characterProfiles, tagCategories, tags, beats, beatColumns, pageLayout, documentFont);
  const filename = `${sanitizeExportFilename(title)}.fdx`;
  const { saveFile } = await import('./fileOps');
  await saveFile(xml, filename, [{ name: 'Final Draft', extensions: ['fdx'] }]);
}
