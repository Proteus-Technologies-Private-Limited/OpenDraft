import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { rtlPlugins } from './vite.rtl'
import { buildTimePlugins } from './vite.plugins'

// Vite 8 uses Rolldown which does NOT transpile JS syntax via build.target.
// So every output chunk is run through esbuild to down-level syntax the
// oldest supported web view cannot parse.
//
// The floor is Safari 15: the iOS app's minimum is iOS 15 and the Mac app's
// is macOS 12, and both use the system WebKit. Without this, one library
// using a class static block or a regex lookbehind (Safari 16.4) in a startup
// chunk is a parse error that stops the whole app from loading — the App
// Store "Loading timed out" review on iOS 15. esbuild rewrites such regex
// literals to `new RegExp(...)`, so the module still parses and only that one
// call fails, if it is ever reached. Built-ins (Array#at, structuredClone…)
// are not syntax; index.html polyfills those.
//
// BUILD_TARGET overrides it: the legacy Intel build sets "es2019" for
// Catalina. That is an ES-year target rather than a Safari one because
// esbuild 0.28+ cannot transform destructuring for Safari targets below 15 —
// even though Safari 13+ supports it fine.
//
// test-script/ios15_compat_scan.mjs checks the result (CI runs it).
const BUILD_TARGET = process.env.BUILD_TARGET || 'safari15'

function legacyTranspile(): Plugin {
  const target = BUILD_TARGET

  return {
    name: 'legacy-transpile',
    apply: 'build',
    async generateBundle(_options, bundle) {
      const { transform } = await import('esbuild')
      for (const [fileName, chunk] of Object.entries(bundle)) {
        // Scripts imported with `?url` are assets, not chunks — pdf.js's
        // worker among them, which ships a class static block even in its
        // "legacy" build and so would not load for PDF import on iOS 15.
        if (chunk.type === 'asset' && /\.m?js$/.test(fileName)) {
          const source = typeof chunk.source === 'string'
            ? chunk.source
            : new TextDecoder().decode(chunk.source)
          try {
            const result = await transform(source, { target, loader: 'js', minify: true, charset: 'utf8' })
            chunk.source = result.code
          } catch (error) {
            throw new Error(`legacy-transpile: could not down-level ${fileName} to ${target}: ${error instanceof Error ? error.message : String(error)}`)
          }
          continue
        }
        if (chunk.type === 'chunk') {
          // Rolldown has already minified the chunk. Minify again rather than
          // print it back out: without minifyIdentifiers esbuild renames
          // every local to dodge collisions (e → e30), which with the
          // whitespace grew the startup chunk by ~13%. utf8 keeps translated
          // strings as written instead of \uXXXX escapes.
          const result = await transform(chunk.code, {
            target,
            loader: 'js',
            minify: true,
            charset: 'utf8',
          })
          chunk.code = result.code
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // buildTimePlugins: plugins from other repos named by OPENDRAFT_PLUGINS
  // (vite.plugins.ts); none unless it is set.
  plugins: [buildTimePlugins(), react(), legacyTranspile()],

  // Mirrored (right-to-left) rules for Arabic and Persian, emitted beside the
  // originals and scoped to [dir="rtl"] — see vite.rtl.ts.
  css: {
    postcss: {
      plugins: rtlPlugins(),
    },
  },

  // Allow Tauri dev server to connect
  server: {
    host: true,
    strictPort: true,
  },

  // Workers are ES modules so they can split and lazy-load their imports —
  // Table Read's Kokoro worker pulls in a large speech library that only the
  // writers who choose Kokoro should ever download.
  worker: {
    format: 'es',
  },

  // Tauri expects a fixed output directory
  build: {
    outDir: 'dist',
    // build.target is kept for CSS transpilation (cssTarget inherits from it)
    target: BUILD_TARGET,
  },
})
