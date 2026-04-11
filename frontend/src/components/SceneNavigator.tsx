import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from '@tiptap/react';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import { useEditorStore } from '../stores/editorStore';
import { computeSceneLengths, computePageBlocks, type PageContentInfo } from '../editor/pagination';
import SynopsisModal from './SynopsisModal';

interface SceneNavigatorProps {
  editor: Editor | null;
  scrollContainer?: HTMLDivElement | null;
  style?: React.CSSProperties;
}

type NavTab = 'scenes' | 'pages' | 'locations';

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

  const dashTime = rest.match(new RegExp(`\\s+-\\s+(${TIME_WORDS})\\.?$`, 'i'));
  if (dashTime) {
    timeOfDay = dashTime[1].toUpperCase();
    rest = rest.slice(0, -dashTime[0].length);
  } else {
    const dotTime = rest.match(new RegExp(`\\.\\s*(${TIME_WORDS})\\.?$`, 'i'));
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

// ── Scene detail helpers ────────────────────────────────────────────────

interface SceneDetail {
  characters: string[];
  location: string;
  prefix: string;
  timeOfDay: string;
  pageLength: number;
}

function formatPageLength(pages: number): string {
  const n = Number(pages.toFixed(2));
  return `${n} ${n <= 1 ? 'page' : 'pages'}`;
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

const SPACE_BEFORE: Record<string, number> = {
  sceneHeading: 1, action: 1, character: 1, dialogue: 0,
  parenthetical: 0, transition: 1, general: 0, shot: 1,
  newAct: 2, endOfAct: 2, lyrics: 0, showEpisode: 1, castList: 0,
};

const LINE_HEIGHT_PX = 12 * (96 / 72); // 16px — matches pagination LINE_HEIGHT_PT

// ── Main component ──────────────────────────────────────────────────────

const SceneNavigator: React.FC<SceneNavigatorProps> = ({ editor, scrollContainer, style }) => {
  const { scenes, navigatorOpen, toggleNavigator, updateSceneSynopsis, updateSceneColor } = useEditorStore();
  const pageLayout = useEditorStore((s) => s.pageLayout);
  const fontFamily = useEditorStore((s) => s.fontFamily);
  const fontSize = useEditorStore((s) => s.fontSize);
  const [activeTab, setActiveTab] = useState<NavTab>('scenes');
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null);
  const [renamingLocation, setRenamingLocation] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Expanded scene (shows synopsis inline)
  const [expandedSceneIdx, setExpandedSceneIdx] = useState<number | null>(null);

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [filterCharacters, setFilterCharacters] = useState<string[]>([]);
  const [filterLocation, setFilterLocation] = useState('');
  const [filterPrefix, setFilterPrefix] = useState('');
  const [filterTime, setFilterTime] = useState('');
  const [filterColor, setFilterColor] = useState('');

  // Page preview state
  const pageGridRef = useRef<HTMLDivElement>(null);
  const [thumbScale, setThumbScale] = useState(0.35);
  const [currentVisiblePage, setCurrentVisiblePage] = useState(1);

  // Synopsis modal state
  const [synopsisModal, setSynopsisModal] = useState<{ sceneIdx: number; id: string; heading: string; synopsis: string; color: string } | null>(null);

  const handleSaveSynopsis = useCallback(
    (synopsis: string, color: string) => {
      if (!synopsisModal || !editor) return;
      const { sceneIdx, id } = synopsisModal;
      updateSceneSynopsis(id, synopsis);
      updateSceneColor(id, color);
      let currentScene = -1;
      let targetPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'sceneHeading') {
          currentScene++;
          if (currentScene === sceneIdx) { targetPos = pos; return false; }
        }
        return true;
      });
      if (targetPos >= 0) {
        const node = editor.state.doc.nodeAt(targetPos);
        if (node) {
          const { tr } = editor.state;
          tr.setNodeMarkup(targetPos, undefined, { ...node.attrs, synopsis, sceneColor: color });
          tr.setMeta('addToHistory', false);
          editor.view.dispatch(tr);
        }
      }
    },
    [synopsisModal, editor, updateSceneSynopsis, updateSceneColor],
  );

  const locations = useMemo(() => groupByLocation(scenes), [scenes]);

  useEffect(() => {
    if (renamingLocation && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingLocation]);

  // ── Compute scene details (characters, location, length) ──

  const sceneDetails = useMemo((): SceneDetail[] => {
    if (!editor) return [];
    const doc = editor.state.doc;
    const lengths = computeSceneLengths(doc, pageLayout);
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
        currentHeading = node.textContent || '';
        currentChars = new Set();
        inScene = true;
      } else if (node.type.name === 'character' && inScene) {
        const raw = node.textContent.trim().toUpperCase();
        const base = raw.replace(/\s*\([^)]*\)\s*/g, '').trim();
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
  }, [editor, scenes, pageLayout]);

  // ── Compute page blocks for page preview ──

  const pageContent = useMemo((): PageContentInfo[] => {
    if (!editor) return [];
    return computePageBlocks(editor.state.doc, pageLayout);
  }, [editor, scenes, pageLayout]);

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
  const getBlockStyle = useCallback((typeName: string, isFirst: boolean): React.CSSProperties => {
    const [left, right] = FD_INDENTS[typeName] || [1.50, 7.50];
    const padL = Math.max(0, (left - pageLayout.leftMargin) * 96);
    const padR = Math.max(0, (pageLayout.pageWidth - right - pageLayout.rightMargin) * 96);
    const sb = isFirst ? 0 : (SPACE_BEFORE[typeName] ?? 0);
    return {
      paddingLeft: padL > 0 ? `${padL}px` : undefined,
      paddingRight: padR > 0 ? `${padR}px` : undefined,
      marginTop: sb > 0 ? `${sb * LINE_HEIGHT_PX}px` : undefined,
    };
  }, [pageLayout]);

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

  const hasActiveFilter = filterCharacters.length > 0 || !!filterLocation || !!filterPrefix || !!filterTime || !!filterColor;

  const filteredIndices = useMemo(() => {
    if (!hasActiveFilter) return scenes.map((_, i) => i);
    return scenes.reduce((acc, scene, idx) => {
      const detail = sceneDetails[idx];
      if (!detail) return acc;
      if (filterCharacters.length > 0 && !filterCharacters.every(c => detail.characters.includes(c))) return acc;
      if (filterLocation && detail.location.toUpperCase() !== filterLocation) return acc;
      if (filterPrefix && detail.prefix !== filterPrefix) return acc;
      if (filterTime && detail.timeOfDay !== filterTime) return acc;
      if (filterColor && (scene.color || '') !== filterColor) return acc;
      acc.push(idx);
      return acc;
    }, [] as number[]);
  }, [scenes, sceneDetails, filterCharacters, filterLocation, filterPrefix, filterTime, hasActiveFilter]);

  // ── Navigate to a scene by index ──

  const goToScene = useCallback(
    (sceneIndex: number) => {
      if (!editor) return;
      const { doc } = editor.state;
      let currentScene = -1;
      let targetPos = 0;
      doc.descendants((node, pos) => {
        if (node.type.name === 'sceneHeading') {
          currentScene++;
          if (currentScene === sceneIndex) { targetPos = pos; return false; }
        }
        return true;
      });
      editor.chain().focus().setTextSelection(targetPos + 1).run();
      requestAnimationFrame(() => {
        const coords = editor.view.coordsAtPos(targetPos + 1);
        if (scrollContainer) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const scrollTo = scrollContainer.scrollTop + (coords.top - containerRect.top) - 60;
          scrollContainer.scrollTo({ top: scrollTo, behavior: 'smooth' });
        }
      });
    },
    [editor, scrollContainer],
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
          scrollContainer.scrollTo({ top: scrollTo, behavior: 'smooth' });
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

    doc.descendants((node, pos) => {
      if (node.type.name !== 'sceneHeading') return true;
      const heading = node.textContent;
      const parsed = parseHeading(heading);
      if (parsed.location.toUpperCase() !== oldName.toUpperCase()) return true;
      let newHeading = parsed.preamble;
      if (parsed.prefix) newHeading += parsed.prefix + ' ';
      newHeading += newName;
      if (parsed.timeOfDay) {
        const usesDot = /\.\s*\w+\.?\s*$/.test(heading) && !/\s-\s/.test(heading);
        newHeading += usesDot ? '. ' + parsed.timeOfDay + '.' : ' - ' + parsed.timeOfDay;
      }
      tr.insertText(newHeading, pos + 1, pos + 1 + heading.length);
      return true;
    });

    if (tr.steps.length > 0) editor.view.dispatch(tr);
    setRenamingLocation(null);
    setExpandedLocation(newName.toUpperCase());
  }, [editor, renamingLocation, renameValue]);

  const { shouldRender, animationState } = useDelayedUnmount(navigatorOpen, 250);
  const navPanelRef = useRef<HTMLDivElement>(null);
  useSwipeDismiss(navPanelRef, { direction: 'left', onDismiss: toggleNavigator, enabled: shouldRender });

  if (!shouldRender) return null;

  const panelClass = animationState === 'entered'
    ? 'panel-open' : animationState === 'exiting' ? 'panel-closing' : '';

  return (
    <>
    <div ref={navPanelRef} className={`scene-navigator ${panelClass}`} style={style}>
      {/* Tab bar */}
      <div className="navigator-tabs">
        <button className={`navigator-tab${activeTab === 'scenes' ? ' active' : ''}`} onClick={() => setActiveTab('scenes')}>Scenes</button>
        <button className={`navigator-tab${activeTab === 'pages' ? ' active' : ''}`} onClick={() => setActiveTab('pages')}>Pages</button>
        <button className={`navigator-tab${activeTab === 'locations' ? ' active' : ''}`} onClick={() => setActiveTab('locations')}>Locations</button>
        <button className="navigator-close" onClick={toggleNavigator} title="Close Navigator">×</button>
      </div>

      {/* ── Scenes tab ───────────────────────────────────────────────── */}
      {activeTab === 'scenes' && (
        <>
          <div className="navigator-header">
            <span className="navigator-title">Scenes</span>
            <span className="scene-count">
              {hasActiveFilter ? `${filteredIndices.length}/` : ''}{scenes.length}
            </span>
            <button
              className={`scene-filter-btn${hasActiveFilter ? ' active' : ''}`}
              onClick={() => setShowFilters(!showFilters)}
              title="Filter scenes"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill={hasActiveFilter ? 'var(--fd-accent)' : 'none'} stroke="currentColor" strokeWidth="1.2">
                <path d="M1.5 2h13l-5 5.5v5l-3-1.5V7.5z" />
              </svg>
            </button>
          </div>

          {showFilters && (
            <div className="scene-filters">
              <div className="scene-filter-group">
                <select
                  className="scene-filter-select"
                  value=""
                  onChange={(e) => {
                    if (e.target.value && !filterCharacters.includes(e.target.value)) {
                      setFilterCharacters([...filterCharacters, e.target.value]);
                    }
                  }}
                >
                  <option value="">Character...</option>
                  {allCharacters.filter(c => !filterCharacters.includes(c)).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
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
                <select className="scene-filter-select" value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}>
                  <option value="">Location...</option>
                  {allLocations.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <select className="scene-filter-select" value={filterPrefix} onChange={(e) => setFilterPrefix(e.target.value)}>
                  <option value="">INT/EXT...</option>
                  {allPrefixes.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="scene-filter-row">
                <select className="scene-filter-select" value={filterTime} onChange={(e) => setFilterTime(e.target.value)}>
                  <option value="">Time of Day...</option>
                  {allTimes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <div className="scene-filter-colors">
                  {['', '#8b5cf6', '#4f46e5', '#2563eb', '#059669', '#eab308', '#f97316', '#ef4444', '#000000', '#ffffff'].map(c => (
                    <button
                      key={c || 'all'}
                      className={`scene-filter-color-dot${filterColor === c ? ' active' : ''}`}
                      style={{ background: c || 'var(--fd-text)', opacity: c ? 1 : 0.25 }}
                      onClick={() => setFilterColor(c)}
                      title={c ? c : 'All colors'}
                    />
                  ))}
                </div>
              </div>
              <div className="scene-filter-row">
                {hasActiveFilter && (
                  <button className="filter-clear-btn" onClick={() => {
                    setFilterCharacters([]);
                    setFilterLocation('');
                    setFilterPrefix('');
                    setFilterTime('');
                    setFilterColor('');
                  }}>Clear All</button>
                )}
              </div>
            </div>
          )}

          <div className="navigator-list">
            {filteredIndices.length === 0 ? (
              <div className="navigator-empty">
                {hasActiveFilter
                  ? 'No scenes match the current filters.'
                  : 'No scenes yet. Start writing a scene heading (INT. or EXT.)'}
              </div>
            ) : (
              filteredIndices.map((sceneIdx) => {
                const scene = scenes[sceneIdx];
                const detail = sceneDetails[sceneIdx];
                const isExpanded = expandedSceneIdx === sceneIdx;
                return (
                  <div key={scene.id} className={`navigator-scene${isExpanded ? ' expanded' : ''}`}>
                    <div className="scene-info" onClick={() => { setExpandedSceneIdx(isExpanded ? null : sceneIdx); goToScene(sceneIdx); }}>
                      <div className="scene-heading-row">
                        <div className="scene-heading-text">
                          {scene.sceneNumber != null && (
                            <span className="scene-number-badge" style={scene.color ? { background: scene.color } : undefined}>{scene.sceneNumber}</span>
                          )}
                          <span className="scene-heading-label">{scene.heading}</span>
                        </div>
                        {detail && detail.pageLength > 0 && (
                          <div className="scene-length" data-tooltip={formatPageLength(detail.pageLength)}>
                            <SceneLengthIcon pages={detail.pageLength} />
                          </div>
                        )}
                      </div>
                      {isExpanded && (
                        <div className="scene-synopsis-expanded">
                          {scene.synopsis ? (
                            <div className="scene-synopsis-text">{scene.synopsis}</div>
                          ) : (
                            <div className="scene-synopsis-empty">No synopsis for this scene available.</div>
                          )}
                          <button
                            className="scene-synopsis-edit-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSynopsisModal({ sceneIdx, id: scene.id, heading: scene.heading, synopsis: scene.synopsis, color: scene.color });
                            }}
                          >
                            {scene.synopsis ? 'Edit' : '+ Add'}
                          </button>
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
            <div className="navigator-empty">No pages yet. Start writing to see page previews.</div>
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
                            style={getBlockStyle(block.typeName, i === 0)}
                          >
                            {block.text || '\u00A0'}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="page-thumb-number">Page {page.pageNumber}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Locations tab ────────────────────────────────────────────── */}
      {activeTab === 'locations' && (
        <>
          <div className="navigator-header">
            <span className="navigator-title">Locations</span>
            <span className="scene-count">{locations.length}</span>
          </div>
          <div className="navigator-list">
            {locations.length === 0 ? (
              <div className="navigator-empty">
                No locations yet. Scene headings like
                &ldquo;INT. COFFEE SHOP - DAY&rdquo; will appear here.
              </div>
            ) : (
              locations.map((loc) => {
                const key = loc.name.toUpperCase();
                const isExpanded = expandedLocation === key;
                const isRenaming = renamingLocation === key;
                return (
                  <div key={key} className="location-group">
                    <div className="location-header" onClick={() => setExpandedLocation(isExpanded ? null : key)}>
                      <span className="location-name">{loc.name}</span>
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
                            Rename Location
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
        onSave={handleSaveSynopsis}
        onClose={() => setSynopsisModal(null)}
      />,
      document.body,
    )}
    </>
  );
};

export default SceneNavigator;
