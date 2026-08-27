/**
 * Offline user manual.
 *
 * The manual lives in the repo under user-manual/ and is deliberately NOT
 * bundled into the app — it would add several megabytes to every build and go
 * stale between releases. Instead the app downloads it from GitHub on demand,
 * stores it in IndexedDB, and reads it from there forever after, so the manual
 * works with no network once it has been fetched a first time.
 *
 * What gets stored: each page's sanitised content HTML, its plain text (for
 * search), every screenshot it references, and the manual's own stylesheet —
 * the viewer renders pages in a shadow root with that sheet applied, so an
 * offline page looks like the published one rather than an approximation of it.
 * An image's src is replaced at download time by a data attribute naming its
 * cached path, which the viewer resolves to an object URL, so a cached page
 * never reaches for the network.
 */

import DOMPurify from 'dompurify';

const REPO = 'Proteus-Technologies-Private-Limited/OpenDraft';
const BRANCH = 'main';
/** raw.githubusercontent serves the manual source with permissive CORS. */
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const MANUAL_BASE = `${RAW_BASE}user-manual/`;

/** The published manual, for the "open in browser" escape hatch. */
export const MANUAL_WEB_URL =
  'https://proteus-technologies-private-limited.github.io/OpenDraft/user-manual/';

/**
 * Attribute holding the repo-relative path of an image that lives in the local
 * cache. A data attribute rather than a custom URI scheme, because a sanitiser
 * will happily drop an unknown scheme but leaves data-* alone.
 */
export const MANUAL_IMG_ATTR = 'data-manual-img';

const DB_NAME = 'opendraft-user-manual';
const DB_VERSION = 1;
const PAGE_STORE = 'pages';
const IMAGE_STORE = 'images';
const META_STORE = 'meta';
const META_KEY = 'install';
const STYLE_KEY = 'stylesheet';

export interface ManualPage {
  slug: string;
  title: string;
  section: string;
  hash?: string;
}

export interface ManualManifest {
  version: string;
  pages: ManualPage[];
}

interface StoredPage extends ManualPage {
  /** Sanitised content HTML; image srcs replaced by MANUAL_IMG_ATTR. */
  html: string;
  /** Flattened text, lower-cased, for search. */
  text: string;
}

interface StoredImage {
  path: string;
  blob: Blob;
}

interface StoredMeta {
  key: string;
  version: string;
  downloadedAt: number;
  pageCount: number;
  imageCount: number;
  bytes: number;
}

export interface ManualStatus {
  installed: boolean;
  version: string | null;
  downloadedAt: number | null;
  pageCount: number;
  imageCount: number;
  bytes: number;
}

export interface ManualSearchHit {
  slug: string;
  title: string;
  section: string;
  snippet: string;
}

export interface ManualProgress {
  done: number;
  total: number;
  label: string;
}

/**
 * Page list used when manifest.json cannot be fetched — an older tag, or a
 * network that resolves GitHub but not the raw host. Keeps the feature usable
 * rather than failing outright.
 */
const FALLBACK_PAGES: ManualPage[] = [
  { slug: 'index.html', title: 'Home', section: 'Getting Started' },
  { slug: 'getting-started.html', title: 'Getting Started', section: 'Getting Started' },
  { slug: 'installation.html', title: 'Installation', section: 'Getting Started' },
  { slug: 'writing-screenplay.html', title: 'Writing Your Screenplay', section: 'Writing' },
  { slug: 'formatting.html', title: 'Formatting', section: 'Writing' },
  { slug: 'title-page.html', title: 'Title Page', section: 'Writing' },
  { slug: 'find-replace.html', title: 'Find & Replace', section: 'Writing' },
  { slug: 'spell-check.html', title: 'Spell Check', section: 'Writing' },
  { slug: 'scene-navigator.html', title: 'Scene Navigator', section: 'Story Planning' },
  { slug: 'index-cards.html', title: 'Index Cards', section: 'Story Planning' },
  { slug: 'beat-board.html', title: 'Beat Board', section: 'Story Planning' },
  { slug: 'characters.html', title: 'Characters', section: 'Characters & Notes' },
  { slug: 'script-notes.html', title: 'Script Notes', section: 'Characters & Notes' },
  { slug: 'script-statistics.html', title: 'Script Statistics & Timing', section: 'Analysis' },
  { slug: 'tags.html', title: 'Tags & Entities', section: 'Production' },
  { slug: 'locations.html', title: 'Locations', section: 'Production' },
  { slug: 'revision-mode.html', title: 'Revision Mode', section: 'Production' },
  { slug: 'projects.html', title: 'Managing Projects', section: 'Projects & Files' },
  { slug: 'version-history.html', title: 'Version History', section: 'Projects & Files' },
  { slug: 'backups.html', title: 'Backups & Recovery', section: 'Projects & Files' },
  { slug: 'import-export.html', title: 'Import & Export', section: 'Projects & Files' },
  { slug: 'format-compatibility.html', title: 'Format Compatibility', section: 'Projects & Files' },
  { slug: 'collaboration.html', title: 'Real-Time Collaboration', section: 'Collaboration' },
  { slug: 'themes.html', title: 'Themes', section: 'Customization' },
  { slug: 'page-setup.html', title: 'Page Setup', section: 'Customization' },
  { slug: 'keyboard-shortcuts.html', title: 'Keyboard Shortcuts', section: 'Customization' },
];

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

function openDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PAGE_STORE)) db.createObjectStore(PAGE_STORE, { keyPath: 'slug' });
        if (!db.objectStoreNames.contains(IMAGE_STORE)) db.createObjectStore(IMAGE_STORE, { keyPath: 'path' });
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbGet<T>(store: string, key: string): Promise<T | null> {
  return openDB().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

function idbGetAll<T>(store: string): Promise<T[]> {
  return openDB().then((db) => {
    if (!db) return [];
    return new Promise<T[]>((resolve) => {
      try {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => resolve((req.result as T[]) ?? []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  });
}

/** Write a batch into one store in a single transaction. */
function idbPutAll(store: string, records: unknown[]): Promise<void> {
  return openDB().then((db) => {
    if (!db) throw new Error('This device has no available storage for the manual.');
    return new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        for (const r of records) os.put(r);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error(`Could not write to ${store}.`));
        tx.onabort = () => reject(tx.error ?? new Error(`Storage rejected the manual (${store}).`));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function idbClear(stores: string[]): Promise<void> {
  return openDB().then((db) => {
    if (!db) return;
    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(stores, 'readwrite');
        for (const s of stores) tx.objectStore(s).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Fetch + parse
// ---------------------------------------------------------------------------

async function fetchText(url: string, what: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    throw new Error(`Could not reach GitHub to download ${what}. Check your connection.`);
  }
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${what}.`);
  return res.text();
}

async function fetchBlob(url: string, what: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch {
    throw new Error(`Could not reach GitHub to download ${what}.`);
  }
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${what}.`);
  return res.blob();
}

/**
 * Pull the readable part out of a manual page and note the images it wants.
 * The manual's own chrome (header, sidebar, search) is dropped — the viewer
 * supplies its own.
 */
function extractPage(rawHtml: string, images: Set<string>): { html: string; text: string } {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  const content = doc.querySelector('main.main .content') || doc.querySelector('main.main') || doc.body;
  if (!content) return { html: '', text: '' };

  content.querySelectorAll('script, style, link, .header, .sidebar, .search-results').forEach((el) => el.remove());

  // Images are referenced as ../images/... relative to user-manual/. Record the
  // repo-relative path and swap in the cache scheme.
  content.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) return;
    if (src.startsWith('http://') || src.startsWith('https://')) {
      img.removeAttribute('src');
      return;
    }
    const path = src.replace(/^\.\.\//, '').replace(/^\.\//, '');
    const repoPath = src.startsWith('../') ? path : `user-manual/${path}`;
    images.add(repoPath);
    img.removeAttribute('src');
    img.setAttribute(MANUAL_IMG_ATTR, repoPath);
    img.setAttribute('loading', 'lazy');
  });

  const clean = DOMPurify.sanitize(content.innerHTML, {
    ADD_ATTR: ['target', 'loading', MANUAL_IMG_ATTR],
  });

  const text = (content.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return { html: clean, text };
}

/**
 * Make the manual's stylesheet work inside a shadow root.
 *
 * `:root` matches the document element, which a shadow tree has none of, so the
 * custom properties would never land. `:host` is its equivalent here, and the
 * rewrite is global rather than anchored: the sheet opens with a comment, so
 * anchoring on start-of-file or a preceding `}` matched nothing and left every
 * variable undefined. The page chrome rules (fixed header, fixed sidebar) have
 * nothing to match in the shadow tree, so they are harmless and left alone;
 * only `.main`'s offsets for that chrome have to go, because the viewer
 * supplies its own layout.
 */
function adaptStylesheet(css: string): string {
  return css.replace(/:root\b/g, ':host') + `
/* Applied by OpenDraft: the shadow tree has no <body> to carry these. */
:host {
  display: block;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: var(--text);
  background: var(--bg);
  line-height: 1.7;
  font-size: 16px;
}
.main { margin: 0; min-height: 0; }
.content { padding: 32px 40px 64px; }
`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The manual's stylesheet, adapted for a shadow root. Null when not cached. */
export async function getManualStylesheet(): Promise<string | null> {
  const rec = await idbGet<{ key: string; css: string }>(META_STORE, STYLE_KEY);
  return rec?.css || null;
}

/** Fetch the page list from GitHub. Falls back to the built-in list. */
export async function fetchManifest(): Promise<ManualManifest> {
  try {
    const raw = await fetchText(`${MANUAL_BASE}manifest.json`, 'the manual index');
    const parsed = JSON.parse(raw) as ManualManifest;
    if (Array.isArray(parsed?.pages) && parsed.pages.length > 0) return parsed;
    throw new Error('empty manifest');
  } catch {
    return { version: 'fallback', pages: FALLBACK_PAGES };
  }
}

export async function getManualStatus(): Promise<ManualStatus> {
  const meta = await idbGet<StoredMeta>(META_STORE, META_KEY);
  if (!meta) {
    return { installed: false, version: null, downloadedAt: null, pageCount: 0, imageCount: 0, bytes: 0 };
  }
  return {
    installed: meta.pageCount > 0,
    version: meta.version,
    downloadedAt: meta.downloadedAt,
    pageCount: meta.pageCount,
    imageCount: meta.imageCount,
    bytes: meta.bytes,
  };
}

/** The cached page list, in manifest order. Empty when nothing is installed. */
export async function getCachedPages(): Promise<ManualPage[]> {
  const pages = await idbGetAll<StoredPage>(PAGE_STORE);
  const meta = await idbGet<{ key: string; order: string[] }>(META_STORE, 'order');
  if (meta?.order) {
    const bySlug = new Map(pages.map((p) => [p.slug, p]));
    return meta.order.map((s) => bySlug.get(s)).filter((p): p is StoredPage => !!p);
  }
  return pages;
}

export async function getCachedPage(slug: string): Promise<StoredPage | null> {
  return idbGet<StoredPage>(PAGE_STORE, slug);
}

export async function getCachedImage(path: string): Promise<Blob | null> {
  const rec = await idbGet<StoredImage>(IMAGE_STORE, path);
  return rec?.blob ?? null;
}

/**
 * Download the whole manual and replace whatever is cached.
 *
 * Pages are fetched first and images second, so a failure part-way through
 * leaves the previous copy untouched — nothing is written until every page has
 * arrived. Images that 404 are skipped rather than failing the install; a
 * missing screenshot is not worth losing the text over.
 */
export async function downloadManual(onProgress?: (p: ManualProgress) => void): Promise<ManualStatus> {
  const manifest = await fetchManifest();
  const images = new Set<string>();
  const pages: StoredPage[] = [];
  const total = manifest.pages.length;

  for (let i = 0; i < manifest.pages.length; i++) {
    const page = manifest.pages[i];
    onProgress?.({ done: i, total, label: page.title });
    const raw = await fetchText(MANUAL_BASE + page.slug, `"${page.title}"`);
    const { html, text } = extractPage(raw, images);
    if (!html) throw new Error(`"${page.title}" arrived empty — the manual may have moved.`);
    pages.push({ ...page, html, text });
  }

  const imagePaths = Array.from(images);
  const stored: StoredImage[] = [];
  let bytes = 0;
  for (let i = 0; i < imagePaths.length; i++) {
    const path = imagePaths[i];
    onProgress?.({ done: total, total, label: `Images (${i + 1} of ${imagePaths.length})` });
    try {
      const blob = await fetchBlob(RAW_BASE + path, path);
      stored.push({ path, blob });
      bytes += blob.size;
    } catch {
      // A screenshot that will not download should not sink the whole manual.
    }
  }

  // The manual's own stylesheet is what makes an offline page look like the
  // published one. Losing it is not fatal — the viewer has a fallback.
  let css = '';
  try {
    onProgress?.({ done: total, total, label: 'Stylesheet' });
    css = adaptStylesheet(await fetchText(`${MANUAL_BASE}style.css`, 'the manual stylesheet'));
    bytes += css.length;
  } catch {
    // fall through with no stylesheet
  }

  bytes += pages.reduce((sum, p) => sum + p.html.length + p.text.length, 0);

  await idbClear([PAGE_STORE, IMAGE_STORE]);
  await idbPutAll(PAGE_STORE, pages);
  if (stored.length) await idbPutAll(IMAGE_STORE, stored);

  const meta: StoredMeta = {
    key: META_KEY,
    version: manifest.version,
    downloadedAt: Date.now(),
    pageCount: pages.length,
    imageCount: stored.length,
    bytes,
  };
  await idbPutAll(META_STORE, [
    meta,
    { key: 'order', order: pages.map((p) => p.slug) },
    { key: STYLE_KEY, css },
  ]);

  onProgress?.({ done: total, total, label: 'Done' });
  return {
    installed: true,
    version: meta.version,
    downloadedAt: meta.downloadedAt,
    pageCount: meta.pageCount,
    imageCount: meta.imageCount,
    bytes: meta.bytes,
  };
}

export async function removeManual(): Promise<void> {
  await idbClear([PAGE_STORE, IMAGE_STORE, META_STORE]);
}

/**
 * Is a newer manual published than the one cached? Needs the network; returns
 * false when offline, so being offline never nags the user to update.
 */
export async function isUpdateAvailable(): Promise<boolean> {
  const status = await getManualStatus();
  if (!status.installed || !status.version || status.version === 'fallback') return false;
  try {
    const raw = await fetchText(`${MANUAL_BASE}manifest.json`, 'the manual index');
    const remote = JSON.parse(raw) as ManualManifest;
    return !!remote?.version && remote.version !== status.version;
  } catch {
    return false;
  }
}

/** Search the cached text. Ranked by title match first, then by hit count. */
export async function searchManual(query: string): Promise<ManualSearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const pages = await getCachedPages();
  const hits: (ManualSearchHit & { score: number })[] = [];

  for (const page of pages) {
    const stored = page as StoredPage;
    if (!stored.text) continue;
    const titleMatch = stored.title.toLowerCase().includes(q);
    const at = stored.text.indexOf(q);
    if (!titleMatch && at < 0) continue;

    let occurrences = 0;
    for (let i = stored.text.indexOf(q); i >= 0; i = stored.text.indexOf(q, i + q.length)) occurrences++;

    let snippet = '';
    if (at >= 0) {
      const start = Math.max(0, at - 60);
      snippet = (start > 0 ? '…' : '') +
        stored.text.slice(start, Math.min(stored.text.length, at + q.length + 90)).trim() +
        (at + q.length + 90 < stored.text.length ? '…' : '');
    }
    hits.push({
      slug: stored.slug,
      title: stored.title,
      section: stored.section,
      snippet,
      score: (titleMatch ? 1000 : 0) + occurrences,
    });
  }

  return hits.sort((a, b) => b.score - a.score).map(({ score, ...hit }) => hit);
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
