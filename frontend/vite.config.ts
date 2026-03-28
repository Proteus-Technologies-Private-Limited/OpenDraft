import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Allow Tauri dev server to connect
  server: {
    strictPort: true,
  },

  // Tauri expects a fixed output directory
  build: {
    outDir: 'dist',
  },
})
