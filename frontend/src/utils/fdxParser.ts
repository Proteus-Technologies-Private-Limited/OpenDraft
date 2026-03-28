// Final Draft XML (.fdx) parser — full formatting & layout support

interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  marks?: TipTapMark[];
  attrs?: Record<string, unknown>;
}

const FDX_TYPE_MAP: Record<string, string> = {
  'Scene Heading': 'sceneHeading',
  'Action': 'action',
  'Character': 'character',
  'Dialogue': 'dialogue',
  'Parenthetical': 'parenthetical',
  'Transition': 'transition',
  'General': 'general',
  'Shot': 'shot',
  'New Act': 'newAct',
  'End of Act': 'endOfAct',
  'Lyrics': 'lyrics',
  'Show/Episode': 'showEpisode',
  'Cast List': 'castList',
  // Aliases
  'Slug': 'sceneHeading',
  'Scene Action': 'action',
  'Dialog': 'dialogue',
  'Singing': 'lyrics',
};

const FDX_ALIGNMENT_MAP: Record<string, string> = {
  'Left': 'left',
  'Center': 'center',
  'Right': 'right',
  'Justify': 'justify',
};

export interface FDXPageLayout {
  pageWidth: number;    // inches
  pageHeight: number;   // inches
  topMargin: number;    // points
  bottomMargin: number; // points
  headerMargin: number; // points
  footerMargin: number; // points
  leftMargin: number;   // inches (Action LeftIndent)
  rightMargin: number;  // inches (pageWidth - Action RightIndent)
}

export interface FDXCastMember {
  name: string;
  description: string;
}

export interface FDXCharacterHighlight {
  name: string;
  color: string;
  highlighted: boolean;
}

export interface FDXTagCategory {
  catId: string;
  name: string;
  color: string;
}

export interface FDXTagItem {
  tagId: string;
  catId: string;
  label: string;
}

export interface FDXParseResult {
  doc: TipTapNode;
  pageLayout: FDXPageLayout | null;
  castList: FDXCastMember[];
  characterHighlighting: FDXCharacterHighlight[];
  tagCategories: FDXTagCategory[];
  tagItems: FDXTagItem[];
}

export function parseFDX(xmlString: string): TipTapNode {
  return parseFDXFull(xmlString).doc;
}

export function parseFDXFull(xmlString: string): FDXParseResult {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
  const nodes: TipTapNode[] = [];

  // --- Parse PageLayout ---
  let pageLayout: FDXPageLayout | null = null;
  const layoutEl = xmlDoc.querySelector('PageLayout');
  if (layoutEl) {
    const pageSize = layoutEl.querySelector('PageSize');
    const pageWidth = parseFloat(pageSize?.getAttribute('Width') || '8.50');

    // Derive left/right margins from Action paragraph indents (the base element)
    // Look for an Action paragraph with explicit indents, or fall back to defaults
    let leftIndent = 1.50;  // Final Draft default
    let rightIndent = 7.50; // Final Draft default
    const actionPara = xmlDoc.querySelector('Paragraph[Type="Action"][LeftIndent]');
    if (actionPara) {
      leftIndent = parseFloat(actionPara.getAttribute('LeftIndent') || '1.50');
      rightIndent = parseFloat(actionPara.getAttribute('RightIndent') || '7.50');
    } else {
      // Check Scene Heading paragraphs as fallback (they often have explicit indents)
      const shPara = xmlDoc.querySelector('Paragraph[Type="Scene Heading"][LeftIndent]');
      if (shPara) {
        leftIndent = parseFloat(shPara.getAttribute('LeftIndent') || '1.50');
        rightIndent = parseFloat(shPara.getAttribute('RightIndent') || '7.50');
      }
    }

    pageLayout = {
      pageWidth,
      pageHeight: parseFloat(pageSize?.getAttribute('Height') || '11.00'),
      topMargin: parseFloat(layoutEl.getAttribute('TopMargin') || '90'),
      bottomMargin: parseFloat(layoutEl.getAttribute('BottomMargin') || '62'),
      headerMargin: parseFloat(layoutEl.getAttribute('HeaderMargin') || '36'),
      footerMargin: parseFloat(layoutEl.getAttribute('FooterMargin') || '36'),
      leftMargin: leftIndent,
      rightMargin: Math.max(0, pageWidth - rightIndent),
    };
  }

  // --- Parse Content ---
  const contentEl = xmlDoc.querySelector('Content');
  if (!contentEl) {
    return { doc: { type: 'doc', content: [{ type: 'action', content: [] }] }, pageLayout, castList: [], characterHighlighting: [], tagCategories: [], tagItems: [] };
  }

  const paragraphs = contentEl.querySelectorAll(':scope > Paragraph');

  paragraphs.forEach((para) => {
    const fdxType = para.getAttribute('Type') || 'General';
    const nodeType = FDX_TYPE_MAP[fdxType] || 'general';

    // --- Paragraph-level attributes ---
    const attrs: Record<string, unknown> = {};

    const sceneNumber = para.getAttribute('Number');
    if (sceneNumber) attrs.sceneNumber = sceneNumber;

    const alignment = para.getAttribute('Alignment');
    if (alignment && FDX_ALIGNMENT_MAP[alignment]) {
      attrs.textAlign = FDX_ALIGNMENT_MAP[alignment];
    }

    // StartsNewPage on individual paragraph (forced page break)
    const startsNewPage = para.getAttribute('StartsNewPage');
    if (startsNewPage === 'Yes') {
      attrs.startsNewPage = true;
    }

    // Per-paragraph spacing override
    const spaceBefore = para.getAttribute('SpaceBefore');
    if (spaceBefore) attrs.spaceBefore = parseInt(spaceBefore, 10);

    // --- Text runs with formatting ---
    const textElements = para.querySelectorAll(':scope > Text');
    const textNodes: TipTapNode[] = [];
    let hasContent = false;

    textElements.forEach((textEl) => {
      const content = textEl.textContent || '';
      if (content === '') return;
      hasContent = true;

      const marks: TipTapMark[] = [];

      // Style: Bold+Italic+Underline+AllCaps+Strikeout
      const style = textEl.getAttribute('Style') || '';
      if (style) {
        const parts = style.split('+').map((s) => s.trim());
        for (const part of parts) {
          if (part === 'Bold') marks.push({ type: 'bold' });
          if (part === 'Italic') marks.push({ type: 'italic' });
          if (part === 'Underline') marks.push({ type: 'underline' });
          // AllCaps handled by CSS text-transform on the element type
        }
      }

      // Font attributes → textStyle mark
      // Skip default screenplay fonts/sizes to avoid unnecessary inline styles
      const fontName = textEl.getAttribute('Font');
      const fontSizeVal = textEl.getAttribute('Size');
      const fontColor = textEl.getAttribute('Color');

      const DEFAULT_FONTS = ['Courier Final Draft', 'Courier New', 'Courier', 'Courier Prime'];
      const isDefaultFont = !fontName || DEFAULT_FONTS.includes(fontName);
      const isDefaultSize = !fontSizeVal || fontSizeVal === '12';
      const hasColor = fontColor && normalizeColor(fontColor) !== '#000000';

      if ((!isDefaultFont) || (!isDefaultSize) || hasColor) {
        const styleAttrs: Record<string, string> = {};
        if (!isDefaultFont && fontName) styleAttrs.fontFamily = fontName;
        if (!isDefaultSize && fontSizeVal) styleAttrs.fontSize = `${fontSizeVal}pt`;
        if (hasColor && fontColor) styleAttrs.color = normalizeColor(fontColor);
        if (Object.keys(styleAttrs).length > 0) {
          marks.push({ type: 'textStyle', attrs: styleAttrs });
        }
      }

      const textNode: TipTapNode = { type: 'text', text: content };
      if (marks.length > 0) textNode.marks = marks;
      textNodes.push(textNode);
    });

    const node: TipTapNode = { type: nodeType };
    if (Object.keys(attrs).length > 0) node.attrs = attrs;
    node.content = hasContent ? textNodes : [];
    nodes.push(node);
  });

  // --- Parse CastList ---
  const castList: FDXCastMember[] = [];
  const castListEl = xmlDoc.querySelector('CastList');
  if (castListEl) {
    const members = castListEl.querySelectorAll('CastMember');
    members.forEach((member) => {
      const nameEl = member.querySelector('Name');
      const descEl = member.querySelector('Description');
      if (nameEl) {
        castList.push({
          name: (nameEl.textContent || '').trim(),
          description: (descEl?.textContent || '').trim(),
        });
      }
    });
  }

  // --- Parse CharacterHighlighting ---
  const characterHighlighting: FDXCharacterHighlight[] = [];
  const highlightEl = xmlDoc.querySelector('CharacterHighlighting');
  if (highlightEl) {
    const chars = highlightEl.querySelectorAll('Character');
    chars.forEach((ch) => {
      const name = ch.getAttribute('Name');
      if (name) {
        characterHighlighting.push({
          name: name.trim(),
          color: normalizeColor(ch.getAttribute('Color') || ''),
          highlighted: ch.getAttribute('Highlighted') === 'Yes',
        });
      }
    });
  }

  // --- Parse TagData ---
  const parsedTagCategories: FDXTagCategory[] = [];
  const parsedTagItems: FDXTagItem[] = [];
  const tagDataEl = xmlDoc.querySelector('TagData');
  if (tagDataEl) {
    tagDataEl.querySelectorAll('TagCategories > TagCategory').forEach((el) => {
      const catId = el.getAttribute('CatId');
      const name = el.getAttribute('Name');
      if (catId && name) {
        parsedTagCategories.push({
          catId: catId.trim(),
          name: name.trim(),
          color: normalizeColor(el.getAttribute('Color') || ''),
        });
      }
    });
    tagDataEl.querySelectorAll('TagItems > TagItem').forEach((el) => {
      const tagId = el.getAttribute('TagId');
      const catId = el.getAttribute('CatId');
      const label = el.getAttribute('Label');
      if (tagId && catId) {
        parsedTagItems.push({
          tagId: tagId.trim(),
          catId: catId.trim(),
          label: (label || '').trim(),
        });
      }
    });
  }

  return {
    doc: {
      type: 'doc',
      content: nodes.length > 0 ? nodes : [{ type: 'action', content: [] }],
    },
    pageLayout,
    castList,
    characterHighlighting,
    tagCategories: parsedTagCategories,
    tagItems: parsedTagItems,
  };
}

/**
 * FDX uses 48-bit hex colors (#RRRRGGGGBBBB) or standard 24-bit (#RRGGBB).
 * Convert to CSS-compatible #RRGGBB.
 */
function normalizeColor(color: string): string {
  if (!color) return '';
  // 48-bit: #RRRRGGGGBBBB → take first 2 of each pair
  if (color.startsWith('#') && color.length === 13) {
    const r = color.substring(1, 3);
    const g = color.substring(5, 7);
    const b = color.substring(9, 11);
    return `#${r}${g}${b}`;
  }
  return color;
}
