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
  await initStorage();

  // Set initial native window title on desktop (for macOS Window menu)
  import('./services/platform').then(({ isDesktopTauri }) => {
    if (!isDesktopTauri()) return;
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('set_window_title', { title: 'Untitled Screenplay' }).catch(() => {});
    });
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

init();
