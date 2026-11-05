/**
 * Right-to-left support for the app's stylesheets, generated at build time.
 *
 * The app's CSS is written left-to-right (`margin-left`, `text-align: right`,
 * `left: 0` …) — about 17,000 lines of it. For Arabic and Persian the interface
 * mirrors; rather than rewrite every rule (and risk the English layout),
 * postcss-rtlcss emits, in "override" mode, an extra rule *under*
 * `[dir="rtl"]` for each directional rule. The original rules are untouched, so
 * the left-to-right UI is byte-for-byte what it was; the extra rules only match
 * while <html dir="rtl"> is set (see i18n/index.ts).
 *
 * What must NOT mirror is the screenplay itself: margins and indents stay where
 * the format puts them (see docs/i18n.md). Those rules are excluded below, and
 * the page is pinned `direction: ltr` — a paragraph that is itself Arabic or
 * Hebrew carries its own `dir` attribute, as it always has.
 */
import type { AcceptedPlugin } from 'postcss';
import rtlcss from 'postcss-rtlcss';

/** Selector parts that belong to the script page and its content. */
export const PAGE_SELECTOR =
  /\.(page|page-sizer|page-container|page-sep[\w-]*|page-thumb[\w-]*|page-thumbnail[\w-]*|screenplay-[\w-]+|scene-heading|action|character|dialogue|parenthetical|transition|general|shot|lyrics|new-act|end-of-act|show-episode|cast-list|custom-element|dual-dialogue[\w-]*|title-page[\w-]*|footnote-block|endnote-page|treatment-page|track-change-[\w-]+|diff-el-[\w-]+|pdf-review-text-[\w-]+|rev-mark|script-note-highlight|suggestion-delete|production-tag-highlight|av-[\w-]+|ProseMirror[\w-]*)(?![\w-])|\[data-type=/;

/** Whole stylesheets that are document content, not chrome. */
const PAGE_FILES = /avScript\.css$/;

/** What is pinned left-to-right inside a right-to-left interface. */
const PINNED_LTR = [
  '.page',
  '.page-thumb-content',
  '.treatment-page',
  '.footnote-block',
  '.endnote-page',
  '.diff-block-content',
  '.pdf-review-text',
];

function ignorePageRules(): AcceptedPlugin {
  return {
    postcssPlugin: 'opendraft-rtl-ignore-page',
    Once(root, { postcss }) {
      const inPageFile = PAGE_FILES.test(root.source?.input.file ?? '');
      root.walkRules((rule) => {
        // Rules nested in @keyframes have no selector of their own.
        if (rule.parent && rule.parent.type === 'atrule' && /keyframes$/.test((rule.parent as { name: string }).name)) return;
        if (inPageFile || PAGE_SELECTOR.test(rule.selector)) {
          rule.before(postcss.comment({ text: 'rtl:ignore' }));
        }
      });
    },
  };
}

function pinPageLtr(): AcceptedPlugin {
  return {
    postcssPlugin: 'opendraft-rtl-pin-page',
    OnceExit(root, { postcss }) {
      // Only the stylesheet that defines the page carries the pin.
      if (!/screenplay\.css$/.test(root.source?.input.file ?? '')) return;
      root.append(
        postcss.rule({ selector: PINNED_LTR.map((s) => `[dir="rtl"] ${s}`).join(',\n') }).append(
          postcss.decl({ prop: 'direction', value: 'ltr' }),
        ),
      );
    },
  };
}

// The generator and the page rules are plugins of a different postcss
// instance than the one vite hands in; the cast keeps both happy.
export function rtlPlugins(): AcceptedPlugin[] {
  return [
    ignorePageRules(),
    rtlcss({ mode: 'override' }) as unknown as AcceptedPlugin,
    pinPageLtr(),
  ];
}
