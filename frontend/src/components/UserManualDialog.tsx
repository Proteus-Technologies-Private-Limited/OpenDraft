import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  FaBars, FaBook, FaCompress, FaDownload, FaExpand, FaExternalLinkAlt, FaSearch, FaSyncAlt, FaTimes, FaTrash,
} from 'react-icons/fa';
import {
  MANUAL_IMG_ATTR,
  MANUAL_WEB_URL,
  downloadManual,
  formatBytes,
  getCachedImage,
  getCachedPage,
  getCachedPages,
  getManualStatus,
  getManualStylesheet,
  isUpdateAvailable,
  removeManual,
  searchManual,
  type ManualPage,
  type ManualProgress,
  type ManualSearchHit,
  type ManualStatus,
} from '../services/userManual';
import { useSwipeDismiss, useSwipeEdge } from '../hooks/useTouch';
import { openExternal } from '../services/platform';

interface UserManualDialogProps {
  onClose: () => void;
}

/** Remembers the full-screen toggle between openings. */
const MANUAL_FULLSCREEN_KEY = 'opendraft:manualFullScreen';
/** Remembers whether the contents list is showing. */
const MANUAL_SIDEBAR_KEY = 'opendraft:manualSidebar';
/** Below this the contents list stacks above the page rather than beside it —
 *  matches the `max-width: 700px` block in screenplay.css. */
const NARROW_PX = 700;

/**
 * Enough styling to keep a page readable if the manual's own stylesheet could
 * not be downloaded. Not a reproduction of it — just a floor.
 */
const FALLBACK_CSS = `
:host { display:block; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:16px; line-height:1.7; color:#1e293b; background:#fff; }
.content { max-width:820px; margin:0 auto; padding:32px 40px 64px; }
h1 { font-size:32px; margin:0 0 16px; } h2 { font-size:24px; margin:32px 0 12px; }
h3 { font-size:18px; margin:24px 0 8px; }
p, li { margin:0 0 12px; } ul, ol { padding-left:24px; }
a { color:#2563eb; } img { max-width:100%; height:auto; }
code, kbd { background:#f1f5f9; border-radius:4px; padding:2px 6px; font-size:14px; }
table { width:100%; border-collapse:collapse; } th, td { border:1px solid #e2e8f0; padding:8px 12px; }
`;

/**
 * The manual's stylesheet is light-only. Re-point its palette when the app is
 * dark, so the reader is not a floodlit sheet in the middle of a dark window.
 */
const DARK_PALETTE = `
:host {
  --bg:#1e1e21; --bg-alt:#26262a; --bg-sidebar:#232327;
  --text:#e6e6e9; --text-light:#a8a8b3; --text-lighter:#7c7c88;
  --border:#3a3a42; --border-light:#2c2c33; --code-bg:#26262c;
  --primary:#6ea8fe; --primary-dark:#9ec5ff; --primary-light:#1c2e4a;
  --shadow:0 1px 3px rgba(0,0,0,.5); --shadow-md:0 4px 12px rgba(0,0,0,.6);
}
`;

/**
 * Is the app on a dark theme? Read from its own background rather than a
 * hard-coded list of theme names, so a new theme needs no change here.
 */
function appIsDark(): boolean {
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--fd-bg').trim();
    const hex = bg.match(/^#([0-9a-f]{6})$/i);
    if (!hex) return document.documentElement.getAttribute('data-theme') !== 'light';
    const n = parseInt(hex[1], 16);
    const luma = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    return luma < 128;
  } catch {
    return false;
  }
}

/**
 * The in-app Help view (issue #94).
 *
 * The manual is not shipped with the app — the first visit offers to download
 * it from GitHub, and every visit after that reads from the local copy with no
 * network involved. Pages render in a shadow root carrying the manual's own
 * stylesheet, so callouts, numbered steps and tables look the way they do
 * online while those styles stay sealed off from the rest of the app.
 */
const UserManualDialog: React.FC<UserManualDialogProps> = ({ onClose }) => {
  const [status, setStatus] = useState<ManualStatus | null>(null);
  const [pages, setPages] = useState<ManualPage[]>([]);
  const [slug, setSlug] = useState<string>('index.html');
  const [html, setHtml] = useState<string>('');
  const [css, setCss] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ManualSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ManualProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  // The contents list is a preference too, and one with a width-dependent
  // default: a wide window has room to keep it beside the page, a narrow one
  // does not. Once someone says otherwise, that answer stands.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(MANUAL_SIDEBAR_KEY);
      if (saved !== null) return saved === '1';
    } catch { /* ignore */ }
    return typeof window === 'undefined' || window.innerWidth > NARROW_PX;
  });

  useEffect(() => {
    try { localStorage.setItem(MANUAL_SIDEBAR_KEY, sidebarOpen ? '1' : '0'); } catch { /* ignore */ }
  }, [sidebarOpen]);
  // Reading the manual full screen is a preference, not a per-visit choice:
  // someone who expanded it once wants it that way the next time too. Phones
  // and tablets are full bleed from CSS regardless, so this only decides what
  // a desktop window opens as.
  const [fullScreen, setFullScreen] = useState(() => {
    try { return localStorage.getItem(MANUAL_FULLSCREEN_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(MANUAL_FULLSCREEN_KEY, fullScreen ? '1' : '0'); } catch { /* ignore */ }
  }, [fullScreen]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Held in state, not just a ref: the contents list mounts only once the
  // manual's status has loaded, and the swipe hook has to re-bind when it
  // appears. A ref alone changes nothing that would re-run an effect.
  const [sidebarEl, setSidebarEl] = useState<HTMLElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  sidebarRef.current = sidebarEl;

  // Swipe the contents list in from the manual's own left edge, and back out
  // again by dragging it. Scoped to the dialog so the editor's navigator, whose
  // gesture starts in the same place, stays out of it.
  useSwipeEdge({
    edge: 'left',
    root: dialogRef,
    onSwipe: () => setSidebarOpen(true),
    enabled: !sidebarOpen,
  });
  useSwipeDismiss(sidebarRef, {
    direction: 'left',
    onDismiss: () => setSidebarOpen(false),
    enabled: sidebarOpen,
    // The list is entirely links, so without this there is nothing left to
    // start the gesture on.
    fromInteractive: true,
  });

  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  /** Object URLs minted for cached images; revoked when the page changes. */
  const objectUrls = useRef<string[]>([]);

  const releaseImages = useCallback(() => {
    for (const url of objectUrls.current) {
      try { URL.revokeObjectURL(url); } catch { /* already gone */ }
    }
    objectUrls.current = [];
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await getManualStatus();
      setStatus(s);
      if (s.installed) {
        setPages(await getCachedPages());
        setCss(await getManualStylesheet());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the stored manual.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    return releaseImages;
  }, [refresh, releaseImages]);

  // Check for a newer manual once, quietly. Offline simply means no update.
  useEffect(() => {
    if (!status?.installed) return;
    let cancelled = false;
    void isUpdateAvailable().then((yes) => { if (!cancelled) setUpdateReady(yes); });
    return () => { cancelled = true; };
  }, [status?.installed]);

  // Load a page's HTML whenever the selection changes.
  useEffect(() => {
    if (!status?.installed) return;
    let cancelled = false;
    void getCachedPage(slug)
      .then((page) => {
        if (cancelled) return;
        setHtml(page?.html ?? '<p>That page is not in the downloaded manual.</p>');
      })
      .catch(() => { if (!cancelled) setError('Could not open that page.'); });
    return () => { cancelled = true; };
  }, [slug, status?.installed]);

  // Render into the shadow root: the manual's stylesheet, then the page.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !html) return;
    if (!shadowRef.current) {
      try {
        shadowRef.current = host.attachShadow({ mode: 'open' });
      } catch {
        setError('This browser could not render the manual.');
        return;
      }
    }
    const shadow = shadowRef.current;
    releaseImages();

    const style = document.createElement('style');
    style.textContent = (css || FALLBACK_CSS) + (appIsDark() ? DARK_PALETTE : '');

    const main = document.createElement('div');
    main.className = 'main';
    const content = document.createElement('div');
    content.className = 'content';
    // Cleaned once on download; cleaned again here because it comes back out
    // of browser storage.
    content.innerHTML = DOMPurify.sanitize(html, {
      ADD_ATTR: ['target', 'loading', MANUAL_IMG_ATTR],
    });
    main.appendChild(content);

    shadow.replaceChildren(style, main);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    let cancelled = false;
    for (const img of Array.from(content.querySelectorAll<HTMLImageElement>(`img[${MANUAL_IMG_ATTR}]`))) {
      const path = img.getAttribute(MANUAL_IMG_ATTR);
      if (!path) continue;
      void getCachedImage(path).then((blob) => {
        if (cancelled) return;
        if (!blob) {
          // The manual references a screenshot the repo does not have. Hide the
          // figure rather than leaving a broken frame in the middle of a page.
          (img.closest('.screenshot') ?? img).setAttribute('style', 'display:none');
          return;
        }
        const url = URL.createObjectURL(blob);
        objectUrls.current.push(url);
        img.setAttribute('src', url);
      });
    }
    return () => { cancelled = true; };
  }, [html, css, releaseImages]);

  const runDownload = useCallback(async () => {
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: 1, label: 'Starting…' });
    try {
      const s = await downloadManual((p) => setProgress(p));
      setStatus(s);
      setPages(await getCachedPages());
      setCss(await getManualStylesheet());
      setUpdateReady(false);
      setSlug('index.html');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The download failed.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, []);

  const runRemove = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await removeManual();
      releaseImages();
      shadowRef.current?.replaceChildren();
      setPages([]);
      setHtml('');
      setCss(null);
      setHits(null);
      setQuery('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the manual.');
    } finally {
      setBusy(false);
    }
  }, [refresh, releaseImages]);

  // Debounce search so typing does not re-scan every page on each keystroke.
  useEffect(() => {
    if (!status?.installed) return;
    if (query.trim().length < 2) { setHits(null); return; }
    const id = window.setTimeout(() => {
      void searchManual(query).then(setHits).catch(() => setHits([]));
    }, 180);
    return () => window.clearTimeout(id);
  }, [query, status?.installed]);

  /**
   * Keep links inside the viewer; send anything external to the browser.
   * Reads composedPath because the anchor lives inside the shadow root, so the
   * event target seen by React is the host element.
   */
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const path = (e.nativeEvent as Event & { composedPath?: () => EventTarget[] }).composedPath?.() ?? [];
    const anchor = path.find(
      (n): n is HTMLAnchorElement => n instanceof HTMLElement && n.tagName === 'A',
    );
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (!href || href.startsWith('#')) return;
    e.preventDefault();
    if (/^https?:/i.test(href)) {
      void openExternal(href);
      return;
    }
    const target = href.split('#')[0].split('/').pop() || '';
    if (pages.some((p) => p.slug === target)) {
      setSlug(target);
      setHits(null);
      setQuery('');
    } else {
      void openExternal(MANUAL_WEB_URL + href.replace(/^\.\//, ''));
    }
  }, [pages]);

  const grouped = useMemo(() => {
    const out: { section: string; pages: ManualPage[] }[] = [];
    for (const page of pages) {
      const last = out[out.length - 1];
      if (last && last.section === page.section) last.pages.push(page);
      else out.push({ section: page.section, pages: [page] });
    }
    return out;
  }, [pages]);

  const openOnline = () => void openExternal(MANUAL_WEB_URL);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        // Swipes inside the manual are the manual's own — see useSwipeEdge.
        data-swipe-zone="manual"
        className={`dialog-box manual-dialog${fullScreen ? ' manual-dialog--full' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header manual-header">
          <span className="manual-header-title"><FaBook /> User Manual</span>
          <div className="manual-header-tools">
            {status?.installed && (
              <div className="manual-search">
                <FaSearch className="manual-search-icon" />
                <input
                  type="text"
                  value={query}
                  placeholder="Search the manual…"
                  aria-label="Search the manual"
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button className="manual-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                    <FaTimes />
                  </button>
                )}
              </div>
            )}
            {status?.installed && (
              <button
                className="manual-icon-btn manual-nav-toggle"
                onClick={() => setSidebarOpen((v) => !v)}
                aria-pressed={sidebarOpen}
                title={sidebarOpen ? 'Hide contents' : 'Show contents'}
                aria-label={sidebarOpen ? 'Hide contents' : 'Show contents'}
              >
                <FaBars />
              </button>
            )}
            <button
              className="manual-icon-btn manual-fullscreen-toggle"
              onClick={() => setFullScreen((v) => !v)}
              aria-pressed={fullScreen}
              title={fullScreen ? 'Restore' : 'Full screen'}
              aria-label={fullScreen ? 'Restore' : 'Full screen'}
            >
              {fullScreen ? <FaCompress /> : <FaExpand />}
            </button>
          </div>
        </div>

        {error && <div className="manual-error">{error}</div>}

        {!status ? (
          <div className="dialog-body manual-empty">Checking for a downloaded copy…</div>
        ) : !status.installed ? (
          <div className="dialog-body manual-empty">
            <FaBook className="manual-empty-icon" />
            <h3>The manual is not on this device yet</h3>
            <p>
              OpenDraft does not ship the manual inside the app. Download it once — about
              8&nbsp;MB of pages and screenshots — and it stays available with no connection.
            </p>
            {busy && progress && (
              <div className="manual-progress">
                <div className="manual-progress-bar">
                  <div
                    className="manual-progress-fill"
                    style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
                  />
                </div>
                <div className="manual-progress-label">{progress.label}</div>
              </div>
            )}
            <div className="manual-empty-actions">
              <button className="dialog-primary" onClick={() => void runDownload()} disabled={busy}>
                <FaDownload /> {busy ? 'Downloading…' : 'Download for offline use'}
              </button>
              <button className="dialog-btn" onClick={openOnline} disabled={busy}>
                <FaExternalLinkAlt /> Read online instead
              </button>
            </div>
          </div>
        ) : (
          <div className="manual-layout">
            <button
              className="manual-sidebar-toggle"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-expanded={sidebarOpen}
            >
              {sidebarOpen ? 'Hide contents' : 'Contents'}
            </button>
            <nav ref={setSidebarEl} className={`manual-sidebar ${sidebarOpen ? 'manual-sidebar--open' : ''}`}>
              {grouped.map((group) => (
                <div className="manual-sidebar-section" key={group.section}>
                  <div className="manual-sidebar-title">{group.section}</div>
                  {group.pages.map((page) => (
                    <button
                      key={page.slug}
                      className={`manual-sidebar-link ${page.slug === slug && !hits ? 'active' : ''}`}
                      onClick={() => { setSlug(page.slug); setHits(null); setQuery('');
                        // Only where the list sits on top of the page — beside it,
                        // closing on every pick would fight the reader.
                        if (window.innerWidth <= NARROW_PX) setSidebarOpen(false); }}
                    >
                      {page.title}
                    </button>
                  ))}
                </div>
              ))}
            </nav>

            <div className="manual-main" ref={scrollRef}>
              {/* Both stay mounted: unmounting the host would discard the shadow
                  root and re-render the page on every search keystroke. */}
              <div style={{ display: hits ? 'block' : 'none' }} className="manual-results">
                <h2>
                  {hits && hits.length === 0
                    ? `Nothing found for “${query}”`
                    : `${hits?.length ?? 0} ${hits?.length === 1 ? 'page' : 'pages'} for “${query}”`}
                </h2>
                {(hits ?? []).map((hit) => (
                  <button
                    key={hit.slug}
                    className="manual-result"
                    onClick={() => { setSlug(hit.slug); setHits(null); setQuery(''); }}
                  >
                    <span className="manual-result-title">{hit.title}</span>
                    <span className="manual-result-section">{hit.section}</span>
                    {hit.snippet && <span className="manual-result-snippet">{hit.snippet}</span>}
                  </button>
                ))}
              </div>
              <div
                ref={hostRef}
                className="manual-shadow-host"
                style={{ display: hits ? 'none' : 'block' }}
                onClick={handleContentClick}
              />
            </div>
          </div>
        )}

        <div className="dialog-actions manual-actions">
          {status?.installed && (
            <div className="manual-meta">
              {formatBytes(status.bytes)} · {status.pageCount} pages
              {status.downloadedAt ? ` · downloaded ${new Date(status.downloadedAt).toLocaleDateString()}` : ''}
              {updateReady && <span className="manual-update-badge">Update available</span>}
            </div>
          )}
          {status?.installed && (
            <>
              <button className="dialog-btn" onClick={openOnline} disabled={busy} title="Open the published manual in your browser">
                <FaExternalLinkAlt /> Online
              </button>
              <button className="dialog-btn" onClick={() => void runDownload()} disabled={busy}>
                <FaSyncAlt /> {busy ? (progress?.label ?? 'Updating…') : 'Update'}
              </button>
              <button className="dialog-btn" onClick={() => void runRemove()} disabled={busy} title="Delete the offline copy">
                <FaTrash /> Remove
              </button>
            </>
          )}
          <button className="dialog-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default UserManualDialog;
