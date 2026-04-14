import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Vite 8 uses Rolldown which does NOT transpile JS syntax via build.target.
// For legacy macOS builds (Catalina / older WKWebView) we run each output
// chunk through esbuild to down-level modern syntax (optional chaining,
// nullish coalescing, logical assignment, class fields, etc.).
//
// We use an ES-year target (e.g. "es2019") instead of a Safari-specific
// target because esbuild 0.28+ cannot transform destructuring for Safari
// targets below 15 — even though Safari 13+ supports it fine.
function legacyTranspile(): Plugin | null {
  const target = process.env.BUILD_TARGET
  if (!target) return null

  return {
    name: 'legacy-transpile',
    apply: 'build',
    async generateBundle(_options, bundle) {
      const { transform } = await import('esbuild')
      for (const [, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk') {
          const result = await transform(chunk.code, {
            target,
            loader: 'js',
          })
          chunk.code = result.code
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), legacyTranspile()].filter(Boolean),

  // Allow Tauri dev server to connect
  server: {
    host: true,
    strictPort: true,
  },

  // Tauri expects a fixed output directory
  build: {
    outDir: 'dist',
    // build.target is kept for CSS transpilation (cssTarget inherits from it)
    ...(process.env.BUILD_TARGET ? { target: process.env.BUILD_TARGET } : {}),
  },
})
