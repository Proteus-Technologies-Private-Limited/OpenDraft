import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Allow Tauri dev server to connect
  server: {
    host: true,
    strictPort: true,
  },

  // Tauri expects a fixed output directory
  build: {
    outDir: 'dist',
    // Legacy Intel builds set BUILD_TARGET=safari13 to support older macOS WebKit
    ...(process.env.BUILD_TARGET ? { target: process.env.BUILD_TARGET } : {}),
  },
})
