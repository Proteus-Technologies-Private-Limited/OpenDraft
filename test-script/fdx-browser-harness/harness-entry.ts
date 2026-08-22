/**
 * Bundle entry: puts the FDX modules on `window` for a real browser DOM.
 *
 * Namespace imports rather than named ones, deliberately — everything the two
 * modules export lands on `window.fdx`, so the harness keeps working as their
 * exports change and you can reach a newly exported helper from the console
 * without editing and rebundling this file.
 */
import * as fdxParser from '../../frontend/src/utils/fdxParser';
import * as fdxExporter from '../../frontend/src/utils/fdxExporter';
import { DEFAULT_PAGE_LAYOUT } from '../../frontend/src/stores/editorStore';

(window as unknown as Record<string, unknown>).fdx = {
  ...fdxParser,
  ...fdxExporter,
  DEFAULT_PAGE_LAYOUT,
};
