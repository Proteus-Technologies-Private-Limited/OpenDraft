import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { initStorage } from './services/api';

async function init() {
  // Apply saved theme before first render to avoid flash
  const savedTheme = localStorage.getItem('opendraft:theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  // On Tauri (desktop + mobile) this swaps the HTTP api with local SQLite.
  // On web it is a no-op — the Python backend is used as-is.
  await initStorage();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

init();
