import '../styles/panelPopout.css';
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { NavigatorPopoutContext } from '../hooks/useNavigatorPopout';
import { FaExternalLinkAlt } from 'react-icons/fa';
import { createPortal } from 'react-dom';
import { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatNumber } from '../i18n/format';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import { useEditorStore, useEditorFields } from '../stores/editorStore';
import {
  computeSceneLengths, computePageBlocks, activeTemplateHints, paginationPluginKey, sceneStartPages,
  type PageContentInfo, type PaginationState,
} from '../editor/pagination';
import { getSpaceBefore } from '../utils/elementSpacing';
import { computeSceneTiming, formatSceneDuration, getTimingColor } from '../utils/scriptTiming';
import { computeScriptStructure, sceneActLabel, type ScriptStructure, type StructureSection } from '../utils/scriptStructure';
import SynopsisModal from './SynopsisModal';
import SceneColorSwatches from './SceneColorSwatches';
import { headingCaseClass } from '../utils/navigatorHeadingCase';
import { useProjectStore } from '../stores/projectStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import {
  allScenesOpen, isSceneOpen, loadExpansion, saveExpansion, setAllScenes, toggleScene, type SynopsisExpansion,
} from '../utils/navigatorSynopses';
import { showToast } from './Toast';
import { blockContentRange, characterKey, singleLine } from '../utils/nodeText';
import Select from './Select';
import { listBookmarks } from '../utils/bookmarks';
import { goToBookmark, removeBookmark } from './bookmarkActions';
import { elementLabel } from '../editor/elementLabels';
import { docJSON, useSettledEditorDoc } from '../hooks/useEditorTransactions';

type NavTab = 'scenes' | 'pages' | 'locations' | 'structure' | 'bookmarks';
const ALL_TABS: NavTab[] = ['scenes', 'pages', 'locations', 'structure', 'bookmarks'];

interface SceneNavigatorProps {
  editor: Editor | null;
  scrollContainer?: HTMLDivElement | null;
  style?: React.CSSProperties;
  /**
   * The Navigator panels this copy shows (Layout › Panels). Each panel can be
   * placed on its own, so a dock may hold some of them and another dock the
   * rest. Unset: all five, as the Navigator has always been.
   */
  tabs?: NavTab[];
  /** The tab to show, when the dock keeps track of it. */
  activeTab?: NavTab;
  onTabChange?: (tab: NavTab) => void;
  /** A panel inside a group with other panels: the group's tab strip names it. */
  bare?: boolean;
}

// ── Scene heading parser ────────────────────────────────────────────────

interface ParsedHeading {
  preamble: string;
  prefix: string;
  location: string;
  timeOfDay: string;
  raw: string;
}

const TIME_WORDS = 'DAY|NIGHT|DAWN|DUSK|MORNING|AFTERNOON|EVENING|SUNSET|SUNRISE|LATER|CONTINUOUS|SAME TIME|MOMENTS LATER|SAME|MAGIC HOUR';
const PREFIX_RE = /(INT\.?\/?EXT\.?|EXT\.?\/?INT\.?|INT\.?|EXT\.?|I\/E\.?)\s+/i;

function normalisePrefix(raw: string): string {
  let p = raw.toUpperCase();
  if (p === 'INT/EXT' || p === 'INT/EXT.' || p === 'EXT/INT' || p === 'EXT/INT.' || p === 'I/E' || p === 'I/E.') return 'INT./EXT.';
  if (!p.endsWith('.')) p += '.';
  return p;
}

function parseHeading(raw: string): ParsedHeading {
  let rest = raw.trim();
  let preamble = '';
  let prefix = '';
  let timeOfDay = '';

  const prefixMatch = rest.match(PREFIX_RE);
  if (prefixMatch && prefixMatch.index !== undefined) {
    preamble = rest.slice(0, prefixMatch.index);
    prefix = normalisePrefix(prefixMatch[1]);
    rest = rest.slice(prefixMatch.index + prefixMatch[0].length);
  }

  // As utils/scriptStatistics: notes in brackets after the time ("NIGHT
  // (1973)") are neither time nor location.
  const trailing = String.raw`(?:\s*(?:\([^)]*\)|\[[^\]]*\]))*`;
  const dashTime = rest.match(new RegExp(`\\s+-\\s+(${TIME_WORDS})\\.?${trailing}\\s*$`, 'i'));
  if (dashTime) {
    timeOfDay = dashTime[1].toUpperCase();
    rest = rest.slice(0, -dashTime[0].length);
  } else {
    const dotTime = rest.match(new RegExp(`\\.\\s*(${TIME_WORDS})\\.?${trailing}\\s*$`, 'i'));
    if (dotTime) {
      timeOfDay = dotTime[1].toUpperCase();
      rest = rest.slice(0, -dotTime[0].length);
    }
  }

  const location = rest.replace(/^[\s.]+|[\s.]+$/g, '');
  return { preamble, prefix, location, timeOfDay, raw };
}

// ── Location grouping ───────────────────────────────────────────────────

interface LocationGroup {
  name: string;
  sceneIndices: number[];
  headings: string[];
  prefixes: string[];
  times: string[];
  preambles: string[];
}

function groupByLocation(scenes: Array<{ heading: string }>): LocationGroup[] {
  const map = new Map<string, LocationGroup>();
  scenes.forEach((scene, index) => {
    const parsed = parseHeading(scene.heading);
    const key = parsed.location.toUpperCase();
    if (!key) return;
    let group = map.get(key);
    if (!group) {
      group = { name: parsed.location, sceneIndices: [], headings: [], prefixes: [], times: [], preambles: [] };
      map.set(key, group);
    }
    group.sceneIndices.push(index);
    group.headings.push(scene.heading);
    group.prefixes.push(parsed.prefix);
    group.times.push(parsed.timeOfDay);
    group.preambles.push(parsed.preamble.replace(/[\s.]+$/, ''));
  });
  return Array.from(map.values());
}

// ── Search highlight helper ─────────────────────────────────────────────

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="navigator-search-highlight">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Scene heading lookup ────────────────────────────────────────────────

/**
 * Position of the nth scene heading, or -1. Scenes are addressed by their place
 * in the script, as everywhere in the Navigator: the list is rebuilt from the
 * document and carries no positions of its own.
 */
function sceneHeadingPos(doc: Editor['state']['doc'], sceneIndex: number): number {
  let seen = -1;
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === 'sceneHeading') {
      seen++;
      if (seen === sceneIndex) { found = pos; return false; }
    }
    return !node.isTextblock;
  });
  return found;
}

/**
 * Ink for a scene number drawn on the scene's own colour: dark on a light
 * colour (yellow, white), light on a dark one.
 */
function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#1a1a1a' : '#ffffff';
}


// ── Scene detail helpers ────────────────────────────────────────────────

interface SceneDetail {
  characters: string[];
  location: string;
  prefix: string;
  timeOfDay: string;
  pageLength: number;
}

function formatPageLength(t: TFunction<['story', 'common']>, pages: number): string {
  const n = Number(pages.toFixed(2));
  return t(n <= 1 ? 'navigator.pageSingular' : 'navigator.pagePlural', { n: formatNumber(n) });
}

// ── Scene Length Icon ────────────────────────────────────────────────────

function getPageFillStyle(pages: number): { color: string; opacity: number } {
  if (pages <= 1) return { color: 'var(--fd-accent)', opacity: 0.6 };
  const t = Math.min((pages - 1) / 4, 1); // 0 at 1 page, 1 at 5+ pages
  const hue = Math.round(120 * (1 - t)); // green(120) → red(0)
  const sat = 65 + Math.round(t * 25);   // 65% → 90%
  const lit = 50 - Math.round(t * 10);   // 50% → 40%
  const opacity = 0.65 + t * 0.3;        // 0.65 → 0.95
  return { color: `hsl(${hue}, ${sat}%, ${lit}%)`, opacity };
}

const SceneLengthIcon: React.FC<{ pages: number }> = React.memo(({ pages }) => {
  const wholePgs = Math.floor(pages);
  const fraction = pages - wholePgs;
  const FILL_TOP = 2.5;
  const FILL_BOT = 14;
  const FILL_H = FILL_BOT - FILL_TOP; // 11.5 — full interior height
  const fillH = (fraction > 0 ? fraction : 1) * FILL_H;
  const { color: fillColor, opacity: fillOpacity } = getPageFillStyle(pages);
  // For multi-page scenes, fill the remaining top portion with the previous page's color
  const showBg = pages > 1 && fraction > 0;
  const bgStyle = showBg ? getPageFillStyle(wholePgs) : null;
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" style={{ flexShrink: 0 }}>
      {wholePgs >= 2 && (
        <rect x="3.5" y="0" width="9.5" height="13.5" rx="1" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />
      )}
      {wholePgs >= 1 && pages > 1 && (
        <rect x="2.5" y="0.5" width="9.5" height="13.5" rx="1" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.3" />
      )}
      <rect x="1" y="1.5" width="9.5" height="13" rx="1" fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.5" />
      {bgStyle && (
        <rect x="2" y={FILL_TOP} width="7.5" height={FILL_H} fill={bgStyle.color} opacity={bgStyle.opacity} rx="0.5" />
      )}
      <rect x="2" y={FILL_BOT - fillH} width="7.5" height={fillH} fill={fillColor} opacity={fillOpacity} rx="0.5" className="scene-length-fill" />
    </svg>
  );
});

// ── Page thumbnail: exact-match layout constants (same as pagination.ts) ─

const FD_INDENTS: Record<string, [number, number]> = {
  sceneHeading: [1.50, 7.50], action: [1.50, 7.50],
  character: [3.50, 7.50], dialogue: [2.50, 6.00],
  parenthetical: [3.00, 5.50], transition: [5.50, 7.50],
  general: [1.50, 7.50], shot: [1.50, 7.50],
  newAct: [1.50, 7.50], endOfAct: [1.50, 7.50],
  lyrics: [2.50, 6.00], showEpisode: [1.50, 7.50],
  castList: [1.50, 7.50],
};

// Space before each element comes from the active template — see
// utils/elementSpacing.ts. The thumbnail must use the same values as
// pagination, or the preview shows a different layout from the page.

const LINE_HEIGHT_PX = 12 * (96 / 72); // 16px — matches pagination LINE_HEIGHT_PT

// ── Section outline ─────────────────────────────────────────────────────

interface SectionOutlineProps {
  sections: StructureSection[];
  onGoToSection: (sectionIndex: number) => void;
  onGoToScene: (sceneIndex: number) => void;
  query: string;
  /** The page's case for scene headings, as a class (see headingCaseClass). */
  headingCase: string;
}

/**
 * The Fountain Section outline, rendered as the tree the hashes describe.
 *
 * Depth comes from the node's own level rather than from how deep the recursion
 * has run, so an outline that skips a rung — `#` straight to `###`, which the
 * format allows — is still drawn where the writer put it.
 */
const SectionOutline: React.FC<SectionOutlineProps> = ({
  sections, onGoToSection, onGoToScene, query, headingCase,
}) => {
  const { t } = useTranslation(['story', 'common']);
  return (
  <>
    {sections.map((section) => (
      <div key={`section-${section.sectionIndex}`} className="structure-section">
        <div
          className="structure-section-header"
          style={{ paddingLeft: `${8 + (section.level - 1) * 12}px` }}
          onClick={() => onGoToSection(section.sectionIndex)}
          title={section.synopsis || undefined}
        >
          <span className="structure-section-level">{'#'.repeat(section.level)}</span>
          <span className="structure-section-name">
            {highlightText(section.title || t('navigator.untitledSection'), query)}
          </span>
          {section.scenes.length > 0 && (
            <span className="structure-section-count">{section.scenes.length}</span>
          )}
        </div>
        {section.synopsis !== '' && (
          <div
            className="structure-section-synopsis"
            style={{ paddingLeft: `${20 + (section.level - 1) * 12}px` }}
          >
            {section.synopsis}
          </div>
        )}
        {section.scenes.length > 0 && (
          <div className="structure-scene-list">
            {section.scenes.map((scene) => (
              <div
                key={`section-scene-${section.sectionIndex}-${scene.sceneIndex}`}
                className="structure-scene"
                style={{ paddingLeft: `${20 + (section.level - 1) * 12}px` }}
                onClick={() => onGoToScene(scene.sceneIndex)}
              >
                <span className="structure-scene-num">{scene.sceneIndex + 1}</span>
                <span className={`structure-scene-heading${headingCase}`}>{scene.heading}</span>
              </div>
            ))}
          </div>
        )}
        <SectionOutline
          sections={section.children}
          onGoToSection={onGoToSection}
          onGoToScene={onGoToScene}
          query={query}
          headingCase={headingCase}
        />
      </div>
    ))}
  </>
  );
};

// ── Main component ──────────────────────────────────────────────────────

const SceneNavigator: React.FC<SceneNavigatorProps> = ({ editor, scrollContainer, style, tabs, activeTab: shownTab, onTabChange, bare = false }) => {
  const popout = React.useContext(NavigatorPopoutContext);
  const { t } = useTranslation(['story', 'common']);
  const { scenes, navigatorOpen, toggleNavigator, updateSceneSynopsis, updateSceneColor, pageLabels } = useEditorFields('scenes', 'navigatorOpen', 'toggleNavigator', 'updateSceneSynopsis', 'updateSceneColor', 'pageLabels');
  const { shouldRender, animationState } = useDelayedUnmount(navigatorOpen, 250);
  // What the panel lists is read off the document, so it follows the edits while
  // showing — once typing pauses, not on every key: its scene lengths, timings
  // and structure each walk the whole script (#229).
  const doc = useSettledEditorDoc(editor, shouldRender);
  const pageLayout = useEditorStore((s) => s.pageLayout);
  const pageCount = useEditorStore((s) => s.pageCount);
  const plotlines = useEditorStore((s) => s.plotlines);
  const fontFamily = useEditorStore((s) => s.fontFamily);
  const fontSize = useEditorStore((s) => s.fontSize);
  const visibleTabs = tabs && tabs.length > 0 ? tabs : ALL_TABS;
  const [ownTab, setOwnTab] = useState<NavTab>(visibleTabs[0]);
  const activeTab: NavTab = shownTab && visibleTabs.includes(shownTab)
    ? shownTab
    : visibleTabs.includes(ownTab) ? ownTab : visibleTabs[0];
  const setActiveTab = (tab: NavTab) => { setOwnTab(tab); onTabChange?.(tab); };
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null);
  const [renamingLocation, setRenamingLocation] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Which scenes are open to their synopsis, remembered per script.
  const currentProjectId = useProjectStore((s) => s.currentProject?.id ?? null);
  const currentScriptId = useProjectStore((s) => s.currentScriptId);
  const expansionKey = currentScriptId ? `${currentProjectId ?? 'local'}:${currentScriptId}` : null;
  const [expansion, setExpansion] = useState<SynopsisExpansion>(() => loadExpansion(expansionKey));
  useEffect(() => { setExpansion(loadExpansion(expansionKey)); }, [expansionKey]);
  const updateExpansion = useCallback((next: SynopsisExpansion) => {
    setExpansion(next);
    saveExpansion(expansionKey, next);
  }, [expansionKey]);

  // Inline editing in a scene row: its colour strip, or its synopsis.
  const [colorStripId, setColorStripId] = useState<string | null>(null);
  const [editingSynopsisId, setEditingSynopsisId] = useState<string | null>(null);
  const [synopsisDraft, setSynopsisDraft] = useState('');
  /** Set once Enter, Esc or blur has ended the edit, so the others do nothing. */
  const synopsisEditDone = useRef(false);

  const headingFont = useEditorStore((s) => s.navigatorHeadingFont);
  const setHeadingFont = useEditorStore((s) => s.setNavigatorHeadingFont);
  // The active format: its spacing changes scene lengths and the page
  // thumbnails without editing the document. Stored templates are replaced,
  // never mutated, so the object itself says when it changed.
  const activeTemplate = useFormattingTemplateStore((s) => s.getActiveTemplate());
  const headingTransform = useFormattingTemplateStore((s) => {
    try {
      return s.getActiveTemplate().rules.sceneHeading?.textTransform;
    } catch (err) {
      console.warn('[navigator] could not read the scene heading rule', err);
      return undefined;
    }
  });
  const caseClass = headingCaseClass(headingTransform);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [scrollingUp, setScrollingUp] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [filterCharacters, setFilterCharacters] = useState<string[]>([]);
  const [filterLocation, setFilterLocation] = useState('');
  const [filterPrefix, setFilterPrefix] = useState('');
  const [filterTime, setFilterTime] = useState('');
  const [filterColor, setFilterColor] = useState('');
  const [filterSynopsis, setFilterSynopsis] = useState('');

  // Page preview state
  const pageGridRef = useRef<HTMLDivElement>(null);
  const [thumbScale, setThumbScale] = useState(0.35);
  const [currentVisiblePage, setCurrentVisiblePage] = useState(1);

  // Synopsis modal state
  const [synopsisModal, setSynopsisModal] = useState<{ sceneIdx: number; id: string; heading: string; synopsis: string; color: string } | null>(null);

  /**
   * Write a scene's synopsis, colour or timing to its heading.
   *
   * The one path the dialog and the inline editors share, so each behaves as
   * the dialog always has for undo and for collaborators: the store updates at
   * once, and the heading's attributes change outside the undo history.
   */
  const writeSceneAttrs = useCallback(
    (sceneIdx: number, id: string, patch: { synopsis?: string; sceneColor?: string; timingOverride?: number | null }) => {
      if (!editor) return;
      if (patch.synopsis !== undefined) updateSceneSynopsis(id, patch.synopsis);
      if (patch.sceneColor !== undefined) updateSceneColor(id, patch.sceneColor);
      try {
        const targetPos = sceneHeadingPos(editor.state.doc, sceneIdx);
        const node = targetPos >= 0 ? editor.state.doc.nodeAt(targetPos) : null;
        if (!node || node.type.name !== 'sceneHeading') {
          console.warn('[navigator] scene heading not found for', id, 'at index', sceneIdx);
          showToast(t('navigator.sceneNotFound'), 'error');
          return;
        }
        const { tr } = editor.state;
        tr.setNodeMarkup(targetPos, undefined, { ...node.attrs, ...patch });
        tr.setMeta('addToHistory', false);
        editor.view.dispatch(tr);
      } catch (err) {
        console.error('[navigator] could not save the scene', err);
        showToast(t('navigator.sceneSaveFailed'), 'error');
      }
    },
    [editor, updateSceneSynopsis, updateSceneColor, t],
  );

  const handleSaveSynopsis = useCallback(
    (synopsis: string, color: string, timingOverride?: number | null) => {
      if (!synopsisModal) return;
      writeSceneAttrs(synopsisModal.sceneIdx, synopsisModal.id, {
        synopsis, sceneColor: color, timingOverride: timingOverride ?? null,
      });
    },
    [synopsisModal, writeSceneAttrs],
  );

  const startSynopsisEdit = useCallback((id: string, current: string) => {
    synopsisEditDone.current = false;
    setColorStripId(null);
    setSynopsisDraft(current);
    setEditingSynopsisId(id);
  }, []);

  const finishSynopsisEdit = useCallback((sceneIdx: number, id: string, original: string, save: boolean) => {
    if (synopsisEditDone.current) return;
    synopsisEditDone.current = true;
    setEditingSynopsisId(null);
    if (save && synopsisDraft !== original) writeSceneAttrs(sceneIdx, id, { synopsis: synopsisDraft });
  }, [synopsisDraft, writeSceneAttrs]);

  const locations = useMemo(() => groupByLocation(scenes), [scenes]);

  useEffect(() => {
    if (renamingLocation && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingLocation]);

  // Detect scroll direction in the scene list — show search bar on scroll-up.
  // Re-run when the Scenes tab becomes active; the `.navigator-list` div is
  // unmounted while the user is on another tab, so the scroll listener must
  // re-attach to the freshly mounted element when they come back.
  useEffect(() => {
    if (activeTab !== 'scenes') return;
    const el = listRef.current;
    if (!el) return;
    lastScrollTop.current = el.scrollTop;
    const onScroll = () => {
      const top = el.scrollTop;
      if (top < lastScrollTop.current) {
        setScrollingUp(true);
      } else if (top > lastScrollTop.current) {
        setScrollingUp(false);
      }
      lastScrollTop.current = top;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [activeTab]);

  // ── Compute scene details (characters, location, length) ──

  const sceneDetails = useMemo((): SceneDetail[] => {
    if (!doc) return [];
    const lengths = computeSceneLengths(
      doc,
      pageLayout,
      activeTemplateHints(),
    );
    const details: SceneDetail[] = [];
    let currentChars = new Set<string>();
    let currentHeading = '';
    let inScene = false;

    doc.forEach((node) => {
      if (node.type.name === 'sceneHeading') {
        if (inScene) {
          const parsed = parseHeading(currentHeading);
          details.push({
            characters: Array.from(currentChars),
            location: parsed.location,
            prefix: parsed.prefix,
            timeOfDay: parsed.timeOfDay,
            pageLength: lengths[details.length] || 0,
          });
        }
        // Headings are single-line by definition here — collapse any break so
        // parseHeading sees one line and the displayed label doesn't wrap.
        currentHeading = singleLine(node.textContent || '');
        currentChars = new Set();
        inScene = true;
      } else if (node.type.name === 'character' && inScene) {
        const base = characterKey(node.textContent);
        if (base) currentChars.add(base);
      }
    });

    if (inScene) {
      const parsed = parseHeading(currentHeading);
      details.push({
        characters: Array.from(currentChars),
        location: parsed.location,
        prefix: parsed.prefix,
        timeOfDay: parsed.timeOfDay,
        pageLength: lengths[details.length] || 0,
      });
    }
    return details;
    // activeTemplate is read through activeTemplateHints(), hence the pragma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageLayout, activeTemplate]);

  // ── Compute scene timing ──

  const sceneTimings = useMemo(() => {
    if (!doc) return [];
    try {
      return computeSceneTiming(docJSON(doc)).scenes;
    } catch {
      return [];
    }
  }, [doc]);

  // ── Compute act/sequence structure ──

  const structure: ScriptStructure = useMemo(() => {
    const empty: ScriptStructure = {
      acts: [], sections: [], totalSections: 0, sceneActMap: new Map(), totalScenes: 0,
    };
    if (!doc) return empty;
    try {
      return computeScriptStructure(docJSON(doc));
    } catch {
      return empty;
    }
  }, [doc]);

  // ── The page each scene starts on ──

  // Read off the breaks the editor drew for its current document, the two
  // taken together so they always belong to each other. Recomputed as the
  // settled document changes, like everything else here.
  const sceneStartPage = useMemo((): number[] => {
    if (!editor || !doc) return [];
    try {
      const state = editor.state;
      const pagination = paginationPluginKey.getState(state) as PaginationState | undefined;
      if (!pagination) return [];
      return sceneStartPages(state.doc, pagination.breaks);
    } catch (err) {
      console.warn('[navigator] could not work out scene pages', err);
      return [];
    }
    // A template or page-layout change repaginates without editing the document,
    // so these stand in for "the breaks changed", which nothing else signals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, doc, pageLayout, pageCount]);

  // ── Collapsed acts / sequences (Structure tab state) ──
  const [collapsedActs, setCollapsedActs] = useState<Set<number>>(new Set());
  const [collapsedSequences, setCollapsedSequences] = useState<Set<string>>(new Set());

  const toggleAct = useCallback((actNumber: number) => {
    setCollapsedActs((prev) => {
      const next = new Set(prev);
      if (next.has(actNumber)) next.delete(actNumber); else next.add(actNumber);
      return next;
    });
  }, []);

  const toggleSequence = useCallback((seqId: string) => {
    setCollapsedSequences((prev) => {
      const next = new Set(prev);
      if (next.has(seqId)) next.delete(seqId); else next.add(seqId);
      return next;
    });
  }, []);

  // ── Compute page blocks for page preview ──

  // Only the Pages tab shows them, and laying out every page is a walk of the
  // whole script per edit (#229).
  const pageContent = useMemo((): PageContentInfo[] => {
    if (!doc || activeTab !== 'pages') return [];
    return computePageBlocks(
      doc,
      pageLayout,
      activeTemplateHints(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageLayout, activeTab, activeTemplate]);

  // ── Exact-match page layout for thumbnails ──

  // Reference width = actual page width in CSS px (inches × 96 DPI)
  const refWidthPx = useMemo(() => pageLayout.pageWidth * 96, [pageLayout.pageWidth]);

  // Inline style for the page content container — matches editor's .page element
  const pageContentStyle = useMemo((): React.CSSProperties => ({
    width: `${refWidthPx}px`,
    paddingTop: `${pageLayout.topMargin}pt`,
    paddingBottom: `${pageLayout.bottomMargin}pt`,
    paddingLeft: `${pageLayout.leftMargin}in`,
    paddingRight: `${pageLayout.rightMargin}in`,
    fontFamily: `'${fontFamily}', 'Courier New', Courier, monospace`,
    fontSize: `${fontSize}pt`,
    lineHeight: `${LINE_HEIGHT_PX}px`,
  }), [refWidthPx, pageLayout, fontFamily, fontSize]);

  // Per-element inline style — same indentation as the editor
  const spaceBefore = useMemo(() => getSpaceBefore(), []);
  const getBlockStyle = useCallback((typeName: string, isFirst: boolean): React.CSSProperties => {
    const [left, right] = FD_INDENTS[typeName] || [1.50, 7.50];
    const padL = Math.max(0, (left - pageLayout.leftMargin) * 96);
    const padR = Math.max(0, (pageLayout.pageWidth - right - pageLayout.rightMargin) * 96);
    const sb = isFirst ? 0 : (spaceBefore[typeName] ?? 0);
    return {
      paddingLeft: padL > 0 ? `${padL}px` : undefined,
      paddingRight: padR > 0 ? `${padR}px` : undefined,
      marginTop: sb > 0 ? `${sb * LINE_HEIGHT_PX}px` : undefined,
    };
  }, [pageLayout, spaceBefore]);

  // ── ResizeObserver for thumbnail scaling ──

  useEffect(() => {
    if (activeTab !== 'pages' || !pageGridRef.current) return;
    const grid = pageGridRef.current;
    const observer = new ResizeObserver(() => {
      const firstThumb = grid.querySelector('.page-thumbnail') as HTMLElement;
      if (firstThumb) {
        setThumbScale(Math.max(0.05, firstThumb.clientWidth / refWidthPx));
      }
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [activeTab, pageContent.length, refWidthPx]);

  // ── Scroll sync: highlight current page in editor ──

  useEffect(() => {
    if (activeTab !== 'pages' || !scrollContainer || !editor || pageContent.length === 0) return;

    let rafId = 0;
    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const rect = scrollContainer.getBoundingClientRect();
        const viewY = rect.top + rect.height / 3;
        try {
          const pos = editor.view.posAtCoords({ left: rect.left + rect.width / 2, top: viewY });
          if (!pos) return;
          let page = 1;
          for (let i = pageContent.length - 1; i >= 0; i--) {
            if (pageContent[i].blocks.length > 0 && pageContent[i].blocks[0].docPos <= pos.pos) {
              page = pageContent[i].pageNumber;
              break;
            }
          }
          if (page !== currentVisiblePage) {
            setCurrentVisiblePage(page);
            const thumbEl = pageGridRef.current?.querySelector(`[data-page="${page}"]`) as HTMLElement;
            if (thumbEl) thumbEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        } catch { /* editor coords may not be available */ }
      });
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // initial sync
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, [activeTab, scrollContainer, editor, pageContent, currentVisiblePage]);

  // ── Filter dropdown options ──

  const allCharacters = useMemo(() => {
    const chars = new Set<string>();
    sceneDetails.forEach(d => d.characters.forEach(c => chars.add(c)));
    return Array.from(chars).sort();
  }, [sceneDetails]);

  const allLocations = useMemo(() => {
    const locs = new Set<string>();
    sceneDetails.forEach(d => { if (d.location) locs.add(d.location.toUpperCase()); });
    return Array.from(locs).sort();
  }, [sceneDetails]);

  const allPrefixes = useMemo(() => {
    const p = new Set<string>();
    sceneDetails.forEach(d => { if (d.prefix) p.add(d.prefix); });
    return Array.from(p).sort();
  }, [sceneDetails]);

  const allTimes = useMemo(() => {
    const t = new Set<string>();
    sceneDetails.forEach(d => { if (d.timeOfDay) t.add(d.timeOfDay); });
    return Array.from(t).sort();
  }, [sceneDetails]);

  // ── Filtered scene indices ──

  const hasActiveFilter = filterCharacters.length > 0 || !!filterLocation || !!filterPrefix || !!filterTime || !!filterColor || !!filterSynopsis;

  const filteredIndices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const synopsisPhrase = filterSynopsis.trim().toLowerCase();
    const noFilters = !hasActiveFilter && !query;
    if (noFilters) return scenes.map((_, i) => i);
    return scenes.reduce((acc, scene, idx) => {
      const detail = sceneDetails[idx];
      if (!detail) return acc;
      // Search bar — matches heading or synopsis
      if (query) {
        const headingMatch = scene.heading.toLowerCase().includes(query);
        const synopsisMatch = (scene.synopsis || '').toLowerCase().includes(query);
        if (!headingMatch && !synopsisMatch) return acc;
      }
      // Filter panel filters
      if (filterCharacters.length > 0 && !filterCharacters.every(c => detail.characters.includes(c))) return acc;
      if (filterLocation && detail.location.toUpperCase() !== filterLocation) return acc;
      if (filterPrefix && detail.prefix !== filterPrefix) return acc;
      if (filterTime && detail.timeOfDay !== filterTime) return acc;
      if (filterColor && (scene.color || '') !== filterColor) return acc;
      if (synopsisPhrase && !(scene.synopsis || '').toLowerCase().includes(synopsisPhrase)) return acc;
      acc.push(idx);
      return acc;
    }, [] as number[]);
  }, [scenes, sceneDetails, searchQuery, filterCharacters, filterLocation, filterPrefix, filterTime, filterColor, filterSynopsis, hasActiveFilter]);

  // ── Navigate to a scene by index ──

  const goToScene = useCallback(
    (sceneIndex: number) => {
      if (!editor) return;
      const found = sceneHeadingPos(editor.state.doc, sceneIndex);
      if (found < 0) {
        console.warn('[navigator] no scene heading at index', sceneIndex);
        return;
      }
      const targetPos = found;
      editor.chain().focus().setTextSelection(targetPos + 1).run();
      requestAnimationFrame(() => {
        const coords = editor.view.coordsAtPos(targetPos + 1);
        if (scrollContainer) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const scrollTo = scrollContainer.scrollTop + (coords.top - containerRect.top) - 60;
          scrollContainer.scrollTo({ top: scrollTo, behavior: 'auto' });
        }
      });
    },
    [editor, scrollContainer],
  );

  /**
   * Scroll to the nth Section in the document.
   *
   * Sections are addressed by their ordinal rather than a stored position for
   * the same reason scenes are: the structure is rebuilt from the document's
   * JSON, which carries no ProseMirror positions.
   */
  const goToSection = useCallback(
    (sectionIndex: number) => {
      if (!editor) return;
      const { doc } = editor.state;
      let seen = -1;
      let targetPos = -1;
      doc.descendants((node, pos) => {
        if (node.type.name === 'section') {
          seen++;
          if (seen === sectionIndex) { targetPos = pos; return false; }
        }
        return true;
      });
      if (targetPos < 0) return;
      editor.chain().focus().setTextSelection(targetPos + 1).run();
      requestAnimationFrame(() => {
        const coords = editor.view.coordsAtPos(targetPos + 1);
        if (scrollContainer) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const scrollTo = scrollContainer.scrollTop + (coords.top - containerRect.top) - 60;
          scrollContainer.scrollTo({ top: scrollTo, behavior: 'auto' });
        }
      });
    },
    [editor, scrollContainer],
  );

  // ── Bookmarks ──
  const setBookmarkEditing = useEditorStore((s) => s.setBookmarkEditing);
  const bookmarks = useMemo(
    () => (doc && activeTab === 'bookmarks' ? listBookmarks(doc) : []),
    [doc, activeTab],
  );

  // ── Navigate to a document position ──

  const goToPosition = useCallback(
    (pos: number) => {
      if (!editor) return;
      editor.chain().focus().setTextSelection(pos + 1).run();
      requestAnimationFrame(() => {
        const coords = editor.view.coordsAtPos(pos + 1);
        if (scrollContainer) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const scrollTo = scrollContainer.scrollTop + (coords.top - containerRect.top) - 60;
          scrollContainer.scrollTo({ top: scrollTo, behavior: 'auto' });
        }
      });
    },
    [editor, scrollContainer],
  );

  // ── Handle page thumbnail click ──

  const handlePageClick = useCallback(
    (page: PageContentInfo, e: React.MouseEvent<HTMLDivElement>) => {
      if (!editor || page.blocks.length === 0) return;
      const contentEl = e.currentTarget.querySelector('.page-thumb-content') as HTMLElement;
      if (!contentEl) return;
      const children = Array.from(contentEl.children) as HTMLElement[];
      const clickY = e.clientY;
      let bestIdx = 0;
      let bestDist = Infinity;
      children.forEach((child, idx) => {
        const rect = child.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const dist = Math.abs(clickY - mid);
        if (dist < bestDist) { bestDist = dist; bestIdx = idx; }
      });
      const block = page.blocks[bestIdx];
      if (block) goToPosition(block.docPos);
    },
    [editor, goToPosition],
  );

  // ── Batch rename a location across all scene headings ──

  const handleRenameSubmit = useCallback(() => {
    if (!editor || !renamingLocation || !renameValue.trim()) {
      setRenamingLocation(null);
      return;
    }
    const oldName = renamingLocation;
    const newName = renameValue.trim();
    if (oldName === newName) { setRenamingLocation(null); return; }

    const { doc, schema, tr } = editor.state;
    const sceneHeadingType = schema.nodes.sceneHeading;
    if (!sceneHeadingType) { setRenamingLocation(null); return; }

    let skippedBroken = 0;
    doc.descendants((node, pos) => {
      if (node.type.name !== 'sceneHeading') return true;
      const heading = node.textContent;
      // A heading containing a hard break can't be rewritten: insertText over
      // the inline range would flatten the break into plain text. Such a
      // heading is a formatting mistake; silently reformatting it is worse
      // than leaving it, so count it and tell the user.
      if (heading.includes('\n')) {
        if (parseHeading(singleLine(heading)).location.toUpperCase() === oldName.toUpperCase()) {
          skippedBroken++;
        }
        return true;
      }
      const parsed = parseHeading(heading);
      if (parsed.location.toUpperCase() !== oldName.toUpperCase()) return true;
      let newHeading = parsed.preamble;
      if (parsed.prefix) newHeading += parsed.prefix + ' ';
      newHeading += newName;
      if (parsed.timeOfDay) {
        const usesDot = /\.\s*\w+\.?\s*$/.test(heading) && !/\s-\s/.test(heading);
        newHeading += usesDot ? '. ' + parsed.timeOfDay + '.' : ' - ' + parsed.timeOfDay;
      }
      // Derive the range from nodeSize, never `pos + 1 + heading.length` —
      // the latter is short by one per inline atom and would leave the tail
      // of the heading behind, duplicating it.
      const { from, to } = blockContentRange(node, pos);
      tr.insertText(newHeading, from, to);
      return true;
    });

    if (skippedBroken > 0) {
      showToast(
        t('navigator.skippedHeadings', { count: skippedBroken }),
        'info',
      );
    }

    if (tr.steps.length > 0) editor.view.dispatch(tr);
    setRenamingLocation(null);
    setExpandedLocation(newName.toUpperCase());
  }, [editor, renamingLocation, renameValue, t]);

  const navPanelRef = useRef<HTMLDivElement>(null);
  useSwipeDismiss(navPanelRef, { direction: 'left', onDismiss: toggleNavigator, enabled: shouldRender });

  if (!shouldRender) return null;

  const panelClass = animationState === 'entered'
    ? 'panel-open' : animationState === 'exiting' ? 'panel-closing' : '';

  return (
    <>
    <div ref={navPanelRef} className={`scene-navigator ${panelClass} nav-heading-font-${headingFont}${bare ? ' scene-navigator-bare' : ''}`} style={style}>
      {/* Tab bar — horizontally scrollable tab strip + pinned close button */}
      {!bare && (
      <div className="navigator-tabs">
        <div className="navigator-tabs-scroll">
          {visibleTabs.map((tab) => (
            <button key={tab} className={`navigator-tab${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)}>{t(`navigator.tabs.${tab}`)}</button>
          ))}
        </div>
        <button className="navigator-close" onClick={toggleNavigator} title={t('navigator.close')}>×</button>
      </div>
      )}

      {/* ── Scenes tab ───────────────────────────────────────────────── */}
      {activeTab === 'scenes' && popout.detached && (
        <button type="button" className="scene-filter-btn" onClick={popout.open}>{t('popout.show')}</button>
      )}
      {activeTab === 'scenes' && !popout.detached && (
        <>
          <div className="navigator-header">
            <span className="navigator-title">{t('navigator.tabs.scenes')}</span>
            {popout.available && <button type="button" data-panel-popout-trigger className="scene-filter-btn" aria-label={t('popout.move')} title={t('popout.move')} onClick={popout.open}><FaExternalLinkAlt aria-hidden="true" /></button>}
            <span className="scene-count">
              {(hasActiveFilter || searchQuery) ? `${filteredIndices.length}/` : ''}{scenes.length}
            </span>
            {(() => {
              const everyOpen = allScenesOpen(expansion, scenes.map((sc) => sc.id));
              const label = everyOpen ? t('navigator.hideAllSynopses') : t('navigator.showAllSynopses');
              return (
                <button
                  type="button"
                  className={`scene-filter-btn scene-expand-all-btn${everyOpen ? ' active' : ''}`}
                  onClick={() => updateExpansion(setAllScenes(!everyOpen))}
                  disabled={scenes.length === 0}
                  title={label}
                  aria-label={label}
                  aria-pressed={everyOpen}
                >
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                    {everyOpen
                      ? <><path d="M4 7l4-3.5L12 7" /><path d="M4 12.5L8 9l4 3.5" /></>
                      : <><path d="M4 3.5L8 7l4-3.5" /><path d="M4 9l4 3.5L12 9" /></>}
                  </svg>
                </button>
              );
            })()}
            <button
              type="button"
              className={`scene-filter-btn scene-heading-font-btn${headingFont === 'script' ? ' active' : ''}`}
              onClick={() => setHeadingFont(headingFont === 'script' ? 'interface' : 'script')}
              title={headingFont === 'script' ? t('navigator.headingFontInterface') : t('navigator.headingFontScript')}
              aria-label={t('navigator.headingFontScript')}
              aria-pressed={headingFont === 'script'}
            >
              {/* i18n-ignore: a type specimen, not a word; the button is named by its translated aria-label */}
              <span aria-hidden="true">Aa</span>
            </button>
            <button
              className={`scene-filter-btn${hasActiveFilter ? ' active' : ''}`}
              onClick={() => setShowFilters(!showFilters)}
              title={t('navigator.filterScenes')}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill={hasActiveFilter ? 'var(--fd-accent)' : 'none'} stroke="currentColor" strokeWidth="1.2">
                <path d="M1.5 2h13l-5 5.5v5l-3-1.5V7.5z" />
              </svg>
            </button>
          </div>

          {showFilters && (
            <div className="scene-filters">
              <div className="scene-filter-group">
                <Select
                  className="scene-filter-select"
                  value=""
                  onChange={(e) => {
                    if (e.target.value && !filterCharacters.includes(e.target.value)) {
                      setFilterCharacters([...filterCharacters, e.target.value]);
                    }
                  }}
                >
                  <option value="">{t('navigator.characterFilter')}</option>
                  {allCharacters.filter(c => !filterCharacters.includes(c)).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
                {filterCharacters.length > 0 && (
                  <div className="filter-tags">
                    {filterCharacters.map(c => (
                      <span key={c} className="filter-tag">
                        {c}
                        <button onClick={() => setFilterCharacters(filterCharacters.filter(x => x !== c))}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="scene-filter-row">
                <Select className="scene-filter-select" value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}>
                  <option value="">{t('navigator.locationFilter')}</option>
                  {allLocations.map(l => <option key={l} value={l}>{l}</option>)}
                </Select>
                <Select className="scene-filter-select" value={filterPrefix} onChange={(e) => setFilterPrefix(e.target.value)}>
                  <option value="">{t('navigator.intExtFilter')}</option>
                  {allPrefixes.map(p => <option key={p} value={p}>{p}</option>)}
                </Select>
              </div>
              <div className="scene-filter-row">
                <Select className="scene-filter-select" value={filterTime} onChange={(e) => setFilterTime(e.target.value)}>
                  <option value="">{t('navigator.timeFilter')}</option>
                  {allTimes.map(tm => <option key={tm} value={tm}>{tm}</option>)}
                </Select>
                <div className="scene-filter-colors">
                  {['', '#8b5cf6', '#4f46e5', '#2563eb', '#059669', '#eab308', '#f97316', '#ef4444', '#000000', '#ffffff'].map(c => (
                    <button
                      key={c || 'all'}
                      className={`scene-filter-color-dot${filterColor === c ? ' active' : ''}`}
                      style={{ background: c || 'var(--fd-text)', opacity: c ? 1 : 0.25 }}
                      onClick={() => setFilterColor(c)}
                      title={c ? c : t('navigator.allColors')}
                    />
                  ))}
                </div>
              </div>
              <div className="scene-filter-row">
                <input
                  className="scene-filter-input"
                  type="text"
                  placeholder={t('navigator.synopsisFilter')}
                  value={filterSynopsis}
                  onChange={(e) => setFilterSynopsis(e.target.value)}
                />
              </div>
              <div className="scene-filter-row">
                {hasActiveFilter && (
                  <button className="filter-clear-btn" onClick={() => {
                    setFilterCharacters([]);
                    setFilterLocation('');
                    setFilterPrefix('');
                    setFilterTime('');
                    setFilterColor('');
                    setFilterSynopsis('');
                  }}>{t('navigator.clearAll')}</button>
                )}
              </div>
            </div>
          )}

          <div className="navigator-list" ref={listRef}>
            {/* Search bar — sticky on scroll-up, scrolls away on scroll-down */}
            <div className={`navigator-search${scrollingUp ? ' navigator-search--pinned' : ''}`}>
              <svg className="navigator-search-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="6.5" cy="6.5" r="5" /><line x1="10" y1="10" x2="14.5" y2="14.5" />
              </svg>
              <input
                className="navigator-search-input"
                type="text"
                placeholder={t('navigator.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="navigator-search-clear" onClick={() => setSearchQuery('')}>×</button>
              )}
            </div>
            {filteredIndices.length === 0 ? (
              <div className="navigator-empty">
                {(hasActiveFilter || searchQuery)
                  ? t('navigator.noMatch')
                  : t('navigator.noScenes')}
              </div>
            ) : (
              filteredIndices.map((sceneIdx) => {
                const scene = scenes[sceneIdx];
                const detail = sceneDetails[sceneIdx];
                const timing = sceneTimings[sceneIdx];
                const isExpanded = isSceneOpen(expansion, scene.id);
                const isEditingSynopsis = editingSynopsisId === scene.id;
                const isColorOpen = colorStripId === scene.id;
                const startPage = sceneStartPage[sceneIdx];
                const pageText = startPage ? String(pageLabels?.[startPage - 1] ?? startPage) : '';
                const toggleLabel = isExpanded ? t('navigator.collapseScene') : t('navigator.expandScene');
                return (
                  <div
                    key={scene.id}
                    className={`navigator-scene${isExpanded ? ' expanded' : ''}`}
                    onContextMenu={(e) => {
                      // Right-click is the other way to the colours — except in
                      // the synopsis editor, where it is the text's own menu.
                      if ((e.target as HTMLElement).closest('textarea, input')) return;
                      e.preventDefault();
                      setEditingSynopsisId(null);
                      setColorStripId(isColorOpen ? null : scene.id);
                    }}
                  >
                    <div className="scene-info" onClick={() => goToScene(sceneIdx)}>
                      <div className="scene-heading-row">
                        <button
                          type="button"
                          className={`scene-expand-toggle structure-chevron${isExpanded ? ' expanded' : ''}`}
                          onClick={(e) => { e.stopPropagation(); updateExpansion(toggleScene(expansion, scene.id)); }}
                          aria-expanded={isExpanded}
                          aria-label={toggleLabel}
                          title={toggleLabel}
                        >&#9662;</button>
                        <div className="scene-heading-text">
                          <button
                            type="button"
                            className={`scene-number-badge scene-color-trigger${scene.color ? ' has-color' : ''}`}
                            style={scene.color ? { background: scene.color, color: readableOn(scene.color) } : undefined}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingSynopsisId(null);
                              setColorStripId(isColorOpen ? null : scene.id);
                            }}
                            aria-expanded={isColorOpen}
                            aria-label={t('navigator.changeColorFor', { number: scene.sceneNumber ?? sceneIdx + 1 })}
                            title={t('navigator.changeColor')}
                          >{scene.sceneNumber ?? sceneIdx + 1}</button>
                          {(() => {
                            const label = sceneActLabel(structure, sceneIdx);
                            return label ? <span className="scene-act-badge" title={t('navigator.actTitle', { number: label.slice(1) })}>{label}</span> : null;
                          })()}
                          <span className={`scene-heading-label${caseClass}`} title={scene.heading}>{highlightText(scene.heading, searchQuery)}</span>
                          {/* The plotlines this scene carries — View → Story Timeline. */}
                          {plotlines.some((p) => scene.plotlineIds?.includes(p.id)) && (
                            <span className="scene-plotline-dots">
                              {plotlines.filter((p) => scene.plotlineIds?.includes(p.id)).map((p) => (
                                <span key={p.id} className="scene-plotline-dot" style={{ background: p.color }} title={p.name || t('navigator.plotline')} />
                              ))}
                            </span>
                          )}
                        </div>
                        {pageText && (
                          <span className="scene-start-page" title={t('navigator.startsOnPage', { label: pageText })}>
                            {pageText}
                          </span>
                        )}
                        {detail && detail.pageLength > 0 && (
                          <div className="scene-length" data-tooltip={
                            formatPageLength(t, detail.pageLength) +
                            (timing?.finalSeconds ? ` · ${formatSceneDuration(timing.finalSeconds)}` : '')
                          }>
                            <SceneLengthIcon pages={detail.pageLength} />
                          </div>
                        )}
                      </div>
                      {isColorOpen && (
                        <div className="scene-color-strip" onClick={(e) => e.stopPropagation()}>
                          <SceneColorSwatches
                            compact
                            autoFocus
                            value={scene.color}
                            onChange={(color, source) => {
                              writeSceneAttrs(sceneIdx, scene.id, { sceneColor: color });
                              // One click to open, one to pick. The custom picker
                              // stays open while its colour is dragged around.
                              if (source === 'preset') setColorStripId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') { e.stopPropagation(); setColorStripId(null); }
                            }}
                          />
                          <button
                            type="button"
                            className="scene-color-strip-close"
                            onClick={() => setColorStripId(null)}
                            aria-label={t('common:close')}
                            title={t('common:close')}
                          >&times;</button>
                        </div>
                      )}
                      {!isExpanded && !isEditingSynopsis && scene.synopsis && (
                        <div className="scene-synopsis-preview">{highlightText(scene.synopsis.split('\n')[0], searchQuery)}</div>
                      )}
                      {(isExpanded || isEditingSynopsis) && (
                        <div className="scene-synopsis-expanded" onClick={(e) => e.stopPropagation()}>
                          {(detail || timing) && (
                            <div className="scene-detail-meta">
                              {detail && detail.pageLength > 0 && (
                                <span className="scene-meta-item">{formatPageLength(t, detail.pageLength)}</span>
                              )}
                              {timing?.finalSeconds > 0 && (
                                <span className="scene-meta-item" style={{ color: getTimingColor(timing.finalSeconds) }}>
                                  {formatSceneDuration(timing.finalSeconds)}
                                  {timing.overrideSeconds != null && ' *'}
                                </span>
                              )}
                            </div>
                          )}
                          {isEditingSynopsis ? (
                            <>
                              <textarea
                                className="scene-synopsis-input"
                                value={synopsisDraft}
                                autoFocus
                                rows={Math.min(8, Math.max(2, synopsisDraft.split('\n').length + 1))}
                                placeholder={t('synopsis.placeholder')}
                                aria-label={t('navigator.synopsisFor', { heading: scene.heading })}
                                onFocus={(e) => { const end = e.currentTarget.value.length; e.currentTarget.setSelectionRange(end, end); }}
                                onChange={(e) => setSynopsisDraft(e.target.value)}
                                onBlur={() => finishSynopsisEdit(sceneIdx, scene.id, scene.synopsis, true)}
                                onKeyDown={(e) => {
                                  // Keys typed here are the synopsis's, never the app's shortcuts.
                                  e.stopPropagation();
                                  if (e.nativeEvent.isComposing) return;
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    finishSynopsisEdit(sceneIdx, scene.id, scene.synopsis, true);
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    finishSynopsisEdit(sceneIdx, scene.id, scene.synopsis, false);
                                  }
                                }}
                              />
                              <div className="scene-synopsis-hint">{t('navigator.synopsisEditHint')}</div>
                            </>
                          ) : scene.synopsis ? (
                            <button
                              type="button"
                              className="scene-synopsis-text"
                              onClick={() => startSynopsisEdit(scene.id, scene.synopsis)}
                              title={t('navigator.clickToEditSynopsis')}
                            >{highlightText(scene.synopsis, searchQuery)}</button>
                          ) : (
                            <button
                              type="button"
                              className="scene-synopsis-empty"
                              onClick={() => startSynopsisEdit(scene.id, '')}
                            >{t('navigator.clickToAddSynopsis')}</button>
                          )}
                          {!isEditingSynopsis && (
                            <button
                              type="button"
                              className="scene-synopsis-edit-btn"
                              onClick={() => {
                                setSynopsisModal({ sceneIdx, id: scene.id, heading: scene.heading, synopsis: scene.synopsis, color: scene.color });
                              }}
                              title={t('navigator.moreSceneOptionsTitle')}
                            >
                              {t('navigator.moreSceneOptions')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ── Pages tab ────────────────────────────────────────────────── */}
      {activeTab === 'pages' && (
        <div className="navigator-list page-thumbnails-scroll" ref={pageGridRef}>
          {pageContent.length === 0 ? (
            <div className="navigator-empty">{t('navigator.noPages')}</div>
          ) : (
            <div className="page-thumbnails-grid">
              {pageContent.map((page) => (
                <div key={page.pageNumber} className="page-thumb-wrapper">
                  <div
                    className={`page-thumbnail${page.pageNumber === currentVisiblePage ? ' current' : ''}`}
                    data-page={page.pageNumber}
                    onClick={(e) => handlePageClick(page, e)}
                  >
                    <div className="page-thumb-content-clip">
                      <div
                        className="page-thumb-content"
                        style={{
                          ...pageContentStyle,
                          transform: `scale(${thumbScale})`,
                        }}
                      >
                        {page.blocks.map((block, i) => (
                          <div
                            key={i}
                            className={`page-thumb-el page-thumb-${block.typeName}`}
                            style={block.lineHeightMultiplier !== 1
                              // Line spacing (utils/lineSpacing): drawn at the pitch the page uses.
                              ? { ...getBlockStyle(block.typeName, i === 0), lineHeight: `${LINE_HEIGHT_PX * block.lineHeightMultiplier}px` }
                              : getBlockStyle(block.typeName, i === 0)}
                          >
                            {block.text || '\u00A0'}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  {/* A locked page reads by its label: "Page 12A". */}
                  <div className="page-thumb-number">{t('navigator.pageLabel', { label: pageLabels?.[page.pageNumber - 1] ?? page.pageNumber })}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Structure tab ────────────────────────────────────────────── */}
      {activeTab === 'structure' && (
        <>
          <div className="navigator-header">
            <span className="navigator-title">{t('navigator.tabs.structure')}</span>
            <span className="scene-count">
              {structure.totalSections > 0
                ? t('navigator.sectionCount', { count: structure.totalSections })
                : (structure.acts.filter((a) => a.actNumber > 0).length
                  ? t('navigator.actCount', { count: structure.acts.filter((a) => a.actNumber > 0).length })
                  : t('navigator.actCountNone'))}
            </span>
          </div>
          <div className="navigator-list">
            {/* The Section outline, when the script has one. It sits above the
                acts rather than inside them: Sections and Act Breaks are two
                separate hierarchies, and a script can use either or both. */}
            {structure.sections.length > 0 && (
              <div className="structure-outline">
                <div className="structure-outline-title">{t('navigator.outline')}</div>
                <SectionOutline
                  sections={structure.sections}
                  onGoToSection={goToSection}
                  onGoToScene={goToScene}
                  query={searchQuery}
                  headingCase={caseClass}
                />
              </div>
            )}
            {structure.acts.length === 0 ? (
              structure.sections.length === 0 && (
                <div className="navigator-empty">
                  {t('navigator.noStructure')}
                </div>
              )
            ) : (
              structure.acts.map((act) => {
                const isCollapsed = collapsedActs.has(act.actNumber);
                const displayName = act.customName
                  ? `${act.actName}: ${act.customName}`
                  : act.actName;
                return (
                  <div key={`act-${act.actNumber}-${act.docPos}`} className="structure-act">
                    <div
                      className="structure-act-header"
                      onClick={() => toggleAct(act.actNumber)}
                    >
                      <span className={`structure-chevron${isCollapsed ? '' : ' expanded'}`}>&#9662;</span>
                      <span className="structure-act-name">{displayName}</span>
                      <span className="structure-act-count">{act.scenes.length}</span>
                    </div>
                    {!isCollapsed && (
                      <div className="structure-act-body">
                        {act.sequences.map((seq) => {
                          const seqCollapsed = collapsedSequences.has(seq.id);
                          return (
                            <div key={seq.id} className="structure-sequence">
                              <div
                                className="structure-sequence-header"
                                onClick={() => toggleSequence(seq.id)}
                              >
                                <span className={`structure-chevron${seqCollapsed ? '' : ' expanded'}`}>&#9662;</span>
                                <span className="structure-sequence-dot" style={{ background: seq.color }} />
                                <span className="structure-sequence-name">{seq.name}</span>
                                <span className="structure-sequence-count">{seq.scenes.length}</span>
                              </div>
                              {!seqCollapsed && (
                                <div className="structure-scene-list">
                                  {seq.scenes.map((s) => (
                                    <div
                                      key={`seq-scene-${s.sceneIndex}`}
                                      className="structure-scene"
                                      onClick={() => goToScene(s.sceneIndex)}
                                    >
                                      <span className="structure-scene-num">{s.sceneIndex + 1}</span>
                                      <span className={`structure-scene-heading${caseClass}`}>{s.heading}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {act.orphanScenes.length > 0 && (
                          <div className="structure-scene-list">
                            {act.orphanScenes.map((s) => (
                              <div
                                key={`orph-scene-${s.sceneIndex}`}
                                className="structure-scene"
                                onClick={() => goToScene(s.sceneIndex)}
                              >
                                <span className="structure-scene-num">{s.sceneIndex + 1}</span>
                                <span className={`structure-scene-heading${caseClass}`}>{s.heading}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ── Bookmarks tab ────────────────────────────────────────────── */}
      {activeTab === 'bookmarks' && (
        <>
          <div className="navigator-header">
            <span className="navigator-title">{t('navigator.tabs.bookmarks')}</span>
            <span className="scene-count">{bookmarks.length}</span>
          </div>
          <div className="navigator-list">
            {bookmarks.length === 0 ? (
              <div className="navigator-empty">
                {t('navigator.noBookmarks')}
              </div>
            ) : (
              bookmarks.map((b) => (
                <div key={b.pos} className="bookmark-item" onClick={() => editor && goToBookmark(editor, b.pos)} title={t('navigator.goToBookmark')}>
                  <span className="bookmark-item-flag" aria-hidden="true" />
                  <div className="bookmark-item-info">
                    <div className="bookmark-item-name">{b.name}</div>
                    <div className="bookmark-item-text">
                      <span className="bookmark-item-type">{elementLabel(b.blockType)}</span>
                      {b.text}
                    </div>
                  </div>
                  <div className="bookmark-item-actions">
                    <button
                      title={t('navigator.renameBookmark')}
                      aria-label={t('navigator.renameBookmarkNamed', { name: b.name })}
                      onClick={(e) => { e.stopPropagation(); setBookmarkEditing({ pos: b.pos, name: b.name, isNew: false }); }}
                    >
                      &#x270E;
                    </button>
                    <button
                      title={t('navigator.removeBookmark')}
                      aria-label={t('navigator.removeBookmarkNamed', { name: b.name })}
                      onClick={(e) => { e.stopPropagation(); if (editor) removeBookmark(editor, b.pos); }}
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ── Locations tab ────────────────────────────────────────────── */}
      {activeTab === 'locations' && (
        <>
          <div className="navigator-header">
            <span className="navigator-title">{t('navigator.tabs.locations')}</span>
            <span className="scene-count">{locations.length}</span>
          </div>
          <div className="navigator-list">
            {locations.length === 0 ? (
              <div className="navigator-empty">
                {t('navigator.noLocations')}
              </div>
            ) : (
              locations.map((loc) => {
                const key = loc.name.toUpperCase();
                const isExpanded = expandedLocation === key;
                const isRenaming = renamingLocation === key;
                return (
                  <div key={key} className="location-group">
                    <div className="location-header" onClick={() => setExpandedLocation(isExpanded ? null : key)}>
                      <span className={`location-name${caseClass}`}>{loc.name}</span>
                      <span className="location-scene-count">{loc.sceneIndices.length}</span>
                      <span className={`location-chevron${isExpanded ? ' expanded' : ''}`}>&#9662;</span>
                    </div>
                    {isExpanded && (
                      <div className="location-detail">
                        {isRenaming ? (
                          <div className="location-rename-row">
                            <input
                              ref={renameInputRef}
                              className="location-rename-input"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value.toUpperCase())}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenamingLocation(null); }}
                              onBlur={handleRenameSubmit}
                            />
                          </div>
                        ) : (
                          <button className="location-rename-btn" onClick={(e) => { e.stopPropagation(); setRenamingLocation(key); setRenameValue(loc.name); }}>
                            {t('navigator.renameLocation')}
                          </button>
                        )}
                        <div className="location-scenes">
                          {loc.sceneIndices.map((sceneIdx, i) => (
                            <div key={sceneIdx} className="location-scene-item" onClick={(e) => { e.stopPropagation(); goToScene(sceneIdx); }}>
                              <span className="location-scene-num">{sceneIdx + 1}.</span>
                              <div className="location-scene-info">
                                <div className="location-scene-top">
                                  <span className="location-scene-prefix">{loc.prefixes[i]}</span>
                                  {loc.times[i] && <span className="location-scene-time">{loc.times[i]}</span>}
                                </div>
                                {loc.preambles[i] && <div className="location-scene-preamble">{loc.preambles[i]}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
    {synopsisModal && createPortal(
      <SynopsisModal
        sceneHeading={synopsisModal.heading}
        synopsis={synopsisModal.synopsis}
        sceneColor={synopsisModal.color}
        pageLength={sceneDetails[synopsisModal.sceneIdx]?.pageLength}
        autoTimingSeconds={sceneTimings[synopsisModal.sceneIdx]?.autoEstimateSeconds}
        timingOverride={sceneTimings[synopsisModal.sceneIdx]?.overrideSeconds}
        onSave={handleSaveSynopsis}
        onClose={() => setSynopsisModal(null)}
      />,
      document.body,
    )}
    </>
  );
};

export default React.memo(SceneNavigator);
