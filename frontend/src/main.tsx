import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { initStorage } from './services/api';

async function init() {
  // Apply saved theme before first render to avoid flash
  const savedTheme = localStorage.getItem('opendraft:theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  // Android needs viewport-fit=cover and explicit safe-area padding
  if (/android/i.test(navigator.userAgent)) {
    document.documentElement.classList.add('android');
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp) vp.setAttribute('content', vp.getAttribute('content') + ', viewport-fit=cover');
  }

  // On Tauri (desktop + mobile) this swaps the HTTP api with local SQLite.
  // On web it is a no-op — the Python backend is used as-is.
  // initStorage() handles its own timeout and fallback internally —
  // no additional wrapping needed here.
  await initStorage();

  // Set initial native window title on desktop (for macOS Window menu)
  import('./services/platform').then(({ isDesktopTauri }) => {
    if (!isDesktopTauri()) return;
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('set_window_title', { title: 'Untitled Screenplay' }).catch(() => {});
    });
  });

  // Clear the loading-timeout diagnostic (and remove overlay if it fired early)
  if ((window as any)._renderTimeout) clearTimeout((window as any)._renderTimeout);
  const fatalOverlay = document.getElementById('_fatal');
  if (fatalOverlay) fatalOverlay.remove();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

init().catch((err) => {
  console.error('Fatal init error:', err);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;background:#1a1a2e;color:#ff6b6b;font:14px/1.6 monospace;padding:40px;white-space:pre-wrap;';
  d.textContent = 'OpenDraft failed to start:\n\n' + (err?.stack || err?.message || String(err));
  document.body.appendChild(d);
});
