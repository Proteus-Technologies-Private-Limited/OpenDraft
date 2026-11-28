# Building an OpenDraft Plugin

This is the document to give a coding agent (or a developer) who is building an
OpenDraft plugin in **another repository** — OpenDraft-Pro or any third-party
host. It explains the contract, where each extension shows up, how a host wires
plugins in, and the rules a plugin has to follow.

The types themselves are not copied here. The source files linked below are the
contract; read them, not a summary of them.

---

## Brief to hand a coding agent

> You are building a plugin for OpenDraft, an open-source screenwriting app
> (React + TipTap frontend, FastAPI backend, Tauri desktop/mobile shells).
> OpenDraft is reachable from this repo as `core/` (a git submodule, or a link
> to a sibling checkout as OD-Sidekick does).
>
> 1. Read `core/docs/PLUGIN_DEVELOPMENT.md` in full before writing code.
> 2. The contract is `core/frontend/src/plugins/registry.ts` (frontend) and
>    `core/backend/app/plugins.py` (backend). Import types from
>    `@core/plugins/registry`.
> 3. Do not edit anything under `core/`. If an extension point you need is
>    missing, stop and describe the hook that would be needed; it gets added to
>    OpenDraft as a general-purpose extension point.
> 4. The desktop and mobile apps have **no Python backend**. Anything that must
>    work there has to run in the frontend. A frontend plugin ships two ways
>    (section 3): as a **runtime plugin** — a folder dropped into a web
>    server's `backend/plugins/`, no rebuild of core — and, for the desktop
>    and mobile apps, compiled in with `OPENDRAFT_PLUGINS=<entry file>` on
>    core's own build.
> 5. Keep data in the script with `pluginRegistry.setDocumentData`, never as a
>    custom node or mark (a script holding one opens blank without the plugin).
> 6. If the plugin sends any of the writer's text off the device, it must be an
>    opt-in add-on (`optIn: true`) with a `privacy` statement.
> 7. Follow section 6 for anything that touches the script or a panel:
>    capturing and inserting text, scrolling to it, drag and drop, layout on
>    phones, and touch screens. Each item there is a mistake already made once.
>
> The plugin I want: <describe the feature, the menu/panel/export/report it
> needs, and which platforms it must run on>.

---

## 1. The contract

### Frontend — `frontend/src/plugins/registry.ts`

A plugin is one `OpenDraftPlugin` object passed to `pluginRegistry.register()`.
Every field except `id`, `name` and `version` is optional.

| Field | What it adds | Key type |
|---|---|---|
| `menuItems` | Items (and submenus) in File, Edit, Format, View, Production, Tools, Help | `PluginMenuEntry`, `PluginMenuChildEntry` |
| `panels` | A component in a UI slot (see section 2) | `PluginPanelEntry` |
| `routes` | A new page, or a replacement for a built-in page (`override: true`) | `PluginRouteEntry` |
| `editorExtensions` | TipTap extensions added to the screenplay editor | TipTap `Extension` / `Node` / `Mark` |
| `importers` | A file format in every import path; a built-in format always wins | `PluginImporter` → `PluginImportResult` |
| `exporters` | A format under File → Export | `PluginExporter` |
| `reports` | A table in Tools → Analytics → Reports, with CSV/PDF export | `PluginReport` → `ReportTable` |
| `sceneActions` | Buttons in Scene Details, per scene or per shot, with an optional preview | `PluginSceneAction`, `PluginSceneBrief` |
| `grammarProviders` | Extra writing suggestions next to the built-in rules | `GrammarProvider` → `GrammarIssue[]` |
| `init`, `destroy` | Start-up work once a script is open; `destroy` undoes it (plugin removed or replaced, add-on turned off) | `PluginContext` |
| `optIn`, `privacy`, `settings`, `onActivate`, `onDeactivate` | Makes the plugin an add-on the writer turns on in Settings → Add-ons | `PluginSettingsProps`, `PluginDeactivateContext` |
| `nameKey`, `descriptionKey`, `labelKey`… | Translated text (see section 5) | — |

Other registry calls:

- `pluginRegistry.registerGrammarProvider(name, fn)` — the same as
  `grammarProviders`, but registered on its own.
- `pluginRegistry.registerUpgradeHandler(fn)` — opens a host's upgrade/checkout
  flow from the "quota exceeded" dialog (`components/QuotaExceededDialog.tsx`).
  Core hides the Upgrade button when no handler is registered.
- `pluginRegistry.subscribe(fn)` — runs `fn` when plugins come, go or are
  turned on/off.
- `pluginRegistry.getEditor()` — the editor open right now, or null.
- `pluginRegistry.getDocumentData(id)` / `setDocumentData(id, value)` /
  `subscribeDocumentData(fn)` — the plugin's own JSON kept **inside the open
  script** (see below).

**Keeping data in the script.** Each plugin can keep one JSON value in the open
script, under its own id. `setDocumentData` stores a JSON copy (it throws, with
a message fit to show, for a value that is not JSON or is over 2 MB) and marks
the script for saving, like a note edit; `undefined` removes the entry. Core
then carries it everywhere the script goes:

| Where | How |
|---|---|
| Save / reopen (web, desktop, mobile) | `_pluginData` in the saved payload (`utils/saveContent.ts`), restored on every load path |
| .odraft, backups, project zips | part of the payload |
| FDX | an `<OpenDraftPluginData>` element after `<Content>`; Final Draft ignores it, OpenDraft reads it back |
| Fountain | a `/* OpenDraft plugin data … */` boneyard block at the end; never printed |
| Linked files (.fdx / .fountain saved in place) | the same as FDX / Fountain |
| Collaboration | synced per plugin: each plugin's entry is its own value, so two plugins never overwrite each other; only two edits to the same plugin's entry race, and the last writer wins |
| PDF, DOCX, Fade In / OSF | not carried: these are print or other-app formats |

An entry is kept even while its plugin is off or not installed, so opening a
script without the plugin never loses its data. Subscribe to hear about any
change — your own writes, another script opened, an import, a collaborator.
Store data, not schema: a script holding a plugin's **node or mark** opens blank
where that plugin is missing, which is why document data exists. The code is
`stores/pluginDataStore.ts` and `utils/pluginData.ts`.

**When `init` runs.** Once per plugin: the first time a script's editor is
ready while the plugin is active. For an add-on that means once the writer has
turned it on; a plugin registered (or an add-on turned on) while a script is
already open starts straight away. Opening another script does not run it
again. `ctx.editor` always reads the editor open *now* (null between scripts),
so keep `ctx` and read `ctx.editor` when you need it — don't keep the editor
itself. A throw is logged and the other plugins still start. History views are
read-only and do not count as an open editor.

**The add-on lifecycle.** For an add-on, in order:

1. **Turned on** (by the writer, or at start-up when it was left on):
   `onActivate` runs. `init` waits for it — it runs only once `onActivate` has
   *succeeded* (and a script is open). If `onActivate` throws or rejects, the
   add-on is left off: none of its menus, panels or other contributions show,
   and `init` does not run. Turned on from Settings → Add-ons, the writer sees
   the error; at start-up it is logged, and the writer's choice is kept so the
   next start tries again.
2. **Turned off**: its contributions are withdrawn at once; then `destroy` runs
   if its `init` had run (so listeners, timers or editor hooks set up in `init`
   stop), then `onDeactivate`. A throw from `destroy` is logged.
3. **Turned on again**: `onActivate`, then `init` again — so whatever `init`
   sets up, `destroy` must tear down.

`destroy` also runs when a plugin is unregistered, and when a plugin is
registered under an id already in use: the old plugin's `destroy` runs before
the new one takes its place (and the new one gets its own `init`). Each call is
wrapped in `try/catch`.

### Backend — `backend/app/plugins.py`

- `register_router(name, router, prefix=None, tags=None)` mounts a FastAPI
  `APIRouter` at `/api/ext/{name}`. Call it **before** `from app.main import app`:
  core includes the routers while `app.main` is imported, ahead of its SPA
  catch-all route.
- `register_hook(event, callback)` — sync or async callbacks, called with
  keyword arguments. The events core actually fires:

| Event | Arguments | Where it fires |
|---|---|---|
| `project:created` | `project` | `api/projects.py` |
| `project:deleted` | `project_id` | `api/projects.py` |
| `script:before_save` | `project_id`, `script_id`, `content` | `api/projects.py` |
| `script:after_save` | `project_id`, `script_id`, `content` | `api/projects.py` |
| `quota:check:create_script` (gate) | `user` | `api/projects.py`, `api/scripts.py` (`services/quota_service.py`) |
| `app:startup` | `app` | `main.py` lifespan, after core is set up and before requests are served |
| `app:shutdown` | `app` | `main.py` lifespan, as the server stops |

Ordinary hooks go through `run_hooks`: an exception is logged and swallowed, so
the save goes on. Gate hooks go through `run_gate_hooks`: raise
`HTTPException` to refuse the request.

Hooks must end up in core's `app.plugins` registry — it is the only one core
calls. A host with its own registration module forwards to it, as Pro's
`pro_app/plugins.register_hook` does.

---

## 2. Where each extension shows up

| Extension | Rendered by | Props / notes |
|---|---|---|
| `menuItems` | `components/MenuBar.tsx` | `action(ctx)` gets `{ editor }`; `disabled`/`checked` may be functions of the same `ctx` |
| panel `right-sidebar` | `components/PluginPanelTabs.tsx` | `{ editor }`; the panel and its tab strip sit side by side in a row of their own (also inside a workspace dock). Beside the page on wide screens, an overlay at ≤900px and full width at ≤480px (as the built-in side panels), under dialogs. Fill the height and scroll inside — see section 6. Open one by dispatching `new CustomEvent('plugin-panel:open', { detail: { panelId } })` on `document` (`PLUGIN_PANEL_OPEN_EVENT`), close with `'plugin-panel:close'` and the same `detail` |
| panel `toolbar` | `components/Toolbar.tsx` | `{ editor }`; the writer places it via toolbar customisation (`components/layout/BarsTab.tsx`, ids `plugin:<panel id>`) — it is not added automatically |
| panel `bottom-panel` | `components/PluginBottomPanels.tsx` | `{ editor }`; a tab strip above the status bar, the open panel above it at a height the writer drags or sets from the keyboard (remembered per device). Same open/close events as the sidebar. Nothing is drawn while no plugin has one |
| panel `status-bar` | `components/PluginBottomPanels.tsx` (`PluginStatusBarItems`) | `{ editor }`; drawn at the end of the status bar |
| `routes` | `App.tsx` | an override can replace only `/projects`, `/project/:projectId` or `/settings` |
| `editorExtensions` | `components/ScreenplayEditor.tsx` | take effect the next time a script is opened |
| `importers` | `utils/importScreenplay.ts` | set `binary: true` for any archive/binary format |
| `exporters` | `components/MenuBar.tsx` (File → Export) | return `Uint8Array` or `string`; core handles the save dialog |
| `reports` | `components/ReportsDialog.tsx`, beside `utils/scriptReports.ts` | CSV/PDF export comes for free |
| `sceneActions` | `components/SceneDetailsPanel.tsx` | `run`, `available` and `preview` get a `PluginSceneActionContext` |
| `grammarProviders` | the grammar extension in the editor | positions are ProseMirror positions offset by `baseOffset`; respect the `AbortSignal` |
| add-on `settings` | `components/AddOnsSettingsSection.tsx` | `{ mode, registerSave }` — see the `PluginSettingsProps` doc comment |

---

## 3. Wiring plugins into a host repo

### Frontend: runtime plugins — a folder per plugin (web)

The simplest way to add a plugin to a web install, and the one that never
touches core: every plugin is a folder of its own in the server's plugins
directory, and the web app loads what it finds there each time it starts.

```
backend/plugins/                 (or OPENDRAFT_PLUGINS_DIR; kept apart from
  od-sidekick/                    backend/static, which build.sh recreates)
    plugin.json
    index.js
    index.css
```

```json
{ "id": "od-sidekick", "name": "Sidekick", "version": "0.1.0",
  "apiVersion": 1, "script": "index.js", "style": "index.css", "defaultEnabled": true }
```

- **Install:** copy the folder in — or link it: a symbolic link to a build
  elsewhere (`backend/plugins/od-sidekick -> ../OD-Sidekick/dist`) is a
  plugin folder like any other, its files confined to the folder it points at.
  **Remove:** delete it. **Hide from everyone:** rename it with a leading `_`
  (or `.`). Reload the page; the server needs no restart, and core's own build
  is never touched.
- Deployed plugins appear in **Settings → Add-ons** when the web app next
  loads. Whether one starts on is decided, first match wins, by:
  1. the writer's own saved choice in that browser;
  2. the administrator's default, set under **Admin Console → Add-ons** (kept in
     `plugin-defaults/` under `OPENDRAFT_DATA_DIR`);
  3. the manifest's `defaultEnabled` (`true` or `false`);
  4. with none of these, the plugin itself: a plain plugin starts **on**, as
     deployed plugins always did before they became add-ons, and one that sets
     `optIn: true` starts off.

  **A default never turns on an add-on that has to ask the writer first** — one
  that has a `settings` screen, or declares `privacy` (or `privacyKey`) without
  also setting `staysOnDevice: true` (for an add-on whose privacy statement says
  nothing leaves the device, e.g. "makes no network requests"). Such an
  add-on stays off until the writer turns it on in Settings → Add-ons, where the
  dialog shows what leaves the device and asks for its settings; a default of on
  only marks it as suggested (`pluginRegistry.isAddOnSuggested(id)`). The same
  holds for add-ons built into the app.
- The folder's name must be the plugin's `id` (lower-case letters, digits,
  hyphens). `script` and `style` are paths inside the folder; `style` is
  optional.
- `apiVersion` is the runtime plugin API the plugin was built for. The server
  and the app skip a plugin that needs a newer one than they offer.

**How core loads them** (`backend/app/frontend_plugins.py`,
`frontend/src/plugins/runtimeLoader.ts`): `GET /api/plugins` lists the valid
folders (anything malformed is logged and skipped) and `/plugins/<id>/…`
serves their files — only for a plugin that list includes (not a `_` folder or
one with a missing or broken `plugin.json`), never a hidden file or folder
(`.git`, `.env`, anything starting with `.`), and never anything resolving
outside the plugin's folder. Keep what a plugin needs at run time in visible
files inside its folder. Before its first render the web app adds each style
sheet and script, waiting at most a few seconds in all. A style sheet whose
script fails to load, or loads without registering a plugin under its id, is
removed again. An add-on that is off keeps its sheet on the page but switched
off (`disabled`), and switched back on with the add-on, so turning it on needs
no reload; still, scope your selectors to your own elements. **Nothing a plugin does can
stop the app from starting:** a plugin's script only hands core a function,
which core runs inside `try/catch`; a plugin that throws, a missing script, a
slow or old server — each is logged and skipped. A plugin already built into
the app (below) is not loaded twice.

**Shared modules (API version 1).** A runtime plugin must not bundle its own
React, ProseMirror or i18next — two copies break hooks, editor state and
translations. Core publishes these modules as globals, and the plugin's build
leaves them out and reads them from there
(`frontend/src/plugins/runtimeHost.ts`):

| Import | Global |
|---|---|
| `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client` | `__ODP_react`, `__ODP_react_jsx_runtime`, … |
| `@tiptap/core`, `@tiptap/react`, `@tiptap/pm/state`, `/model`, `/view`, `/transform` | `__ODP__tiptap_core`, `__ODP__tiptap_pm_state`, … |
| `i18next`, `react-i18next` | `__ODP_i18next`, `__ODP_react_i18next` |
| `@core/plugins/registry`, `@core/i18n`, `@core/components/Toast` | `__ODP__core_plugins_registry`, … |

The global's name is `__ODP_` plus the import with every character other than
a letter or digit turned into `_`. Everything else the plugin uses it bundles
itself (react-icons, its own code). Nothing else from core is available at
run time: import only these three `@core/…` modules, and import them
statically (`import()` of a core module does not work in a runtime plugin).

**Building one** — a Vite library build to a single IIFE script, the shared
modules external, and the script wrapped so that loading it runs nothing
(OD-Sidekick's `vite.runtime.config.ts`, `npm run package`, is the full
version, with a check that fails the build on any other `@core/…` import):

```ts
build: {
  lib: { entry: 'src/register.ts', formats: ['iife'], name: 'MyPlugin', fileName: () => 'index.js', cssFileName: 'index' },
  rollupOptions: {
    external: (id) => SHARED.has(id),                         // the table above
    output: {
      globals: (id) => `__ODP_${id.replace(/[^a-zA-Z0-9]/g, '_')}`,
      banner: `(globalThis.__OPENDRAFT_PLUGIN_QUEUE__ = globalThis.__OPENDRAFT_PLUGIN_QUEUE__ || []).push(["my-plugin", function () {`,
      footer: '}]);',
    },
  },
},
```

Then write `plugin.json` beside `index.js` and `index.css`, and that folder is
the plugin.

**Limits.** Runtime plugins are for the web app: the desktop and mobile apps
have no server to load them from, and the stores do not allow code downloaded
at run time. Ship to the apps with a build-time plugin (next section) — the
same `src/register.ts` serves both. A runtime plugin's script runs with the
app's full rights: install only plugins you trust.

### Frontend: build-time plugins (desktop, mobile, and web builds)

Core compiles plugins from other folders into its own build when
`OPENDRAFT_PLUGINS` names their entry modules (`frontend/vite.plugins.ts`).
An entry is a module that calls `pluginRegistry.register(...)` when imported;
`main.tsx` imports every entry first, through `virtual:opendraft-plugins`, so
plugins are registered before anything renders. Unset, nothing changes.

```bash
# one entry; several are separated by ":" (";" on Windows)
OPENDRAFT_PLUGINS=$PWD/../my-plugin/src/register.ts npm run dev     # in core/frontend
OPENDRAFT_PLUGINS=$PWD/../my-plugin/src/register.ts npm run build
OPENDRAFT_PLUGINS=$PWD/my-plugin/src/register.ts frontend/node_modules/.bin/tauri build   # in core/
```

What core does for a plugin it builds in:

- `@core/…` imports resolve to `frontend/src/…`.
- Package imports (`react`, `@tiptap/pm/state`, `react-i18next` …) from the
  plugin's files resolve from **core's** `node_modules`, as if core had made
  them — one copy of React, ProseMirror and i18next in the bundle, whatever the
  plugin's own folder holds. A package core does not have is a build warning.
- The dev server may serve the plugin's folder (the nearest one above the
  entry with a `package.json`).

Because the same variable works with every core build command, the **desktop
and mobile apps** get the plugin exactly like the web app: `tauri build`,
`tauri android build` and `build-ios-device.sh` all run core's Vite build. The
code is compiled in, never downloaded, which App Store guideline 2.5.2
requires. OD-Sidekick's `vite.config.ts` and `scripts/build-app.sh` are the
worked example.

Official releases build OD-Sidekick in this way on every platform. Release CI
checks it out into `build-plugins/` and sets `OPENDRAFT_PLUGINS`
(`docs/RELEASE.md`, "Add-ons built into every platform"). A change to a core
module Sidekick imports through `@core/…` therefore reaches the release
build. Check it against OD-Sidekick before tagging.

For unit tests outside core, resolve package imports the same way in the test
runner (OD-Sidekick's `core.config.ts`) and use core's `src/test/setup.ts` as a
setup file.

### Frontend: a separate host app (OpenDraft-Pro)

Pro predates build-time plugins and keeps its own Vite app:

```
host/
  core/                         ← OpenDraft as a git submodule
  host-frontend/                ← Vite app: vite.config.ts, src/main.tsx, src/plugins.ts
  host-backend/                 ← FastAPI entry that imports core's app
  plugins/<id>/frontend/index.ts   ← default-exports an OpenDraftPlugin
  plugins/<id>/backend/router.py   ← exports `router` (optional)
```

- **Alias** `@core` → `core/frontend/src`, and point `react`, `react-dom`,
  `react-router-dom`, `zustand` and `react-icons` at the host's `node_modules`.
- **Dedupe** every TipTap, ProseMirror and Yjs package (`@tiptap/*`,
  `prosemirror-*`, `yjs`, `y-prosemirror`, `y-protocols`). With two copies,
  the editor crashes with `Cannot read properties of undefined (reading
  'localsInner')`. The full list is in OpenDraft-Pro's
  `pro-frontend/vite.config.ts`.
- Allow Vite to serve files from the host root (`server.fs.allow`), since core
  and plugins live outside the frontend folder.
- **Register before render.** The entry file imports a `plugins.ts` that calls
  `pluginRegistry.register(...)` for each plugin, *then* calls
  `initStorage()` from `@core/services/api` and renders the app.
- **One registry.** Import from `@core/plugins/registry`, or from a host file
  that re-exports all of it (`export * from '@core/plugins/registry'`, as Pro's
  `pro-frontend/src/plugins/registry.ts` does). There must be a single
  `pluginRegistry` instance in the bundle.

A separate host app does not reach the desktop or mobile apps; build-time
plugins do.

### Backend

1. Put `core/backend` first on `sys.path` and load `core/backend/.env` before
   anything imports `app.config` (auth reads `COLLAB_JWT_SECRET` at import time).
2. Load each plugin's `router.py` and call core's
   `app.plugins.register_router(name, router)` / `register_hook(...)`.
3. `from app.main import app` and serve that.

Pro's `pro-backend/pro_app/main.py` keeps its own router list and mounts the
routers after importing the app, which is why it has to move the SPA catch-all
route; its hooks are forwarded to core. A new host is simpler calling core's
`register_router` before the import.

---

## 4. Platform limits

- **No Python backend in the apps.** The desktop (macOS, Windows, Linux),
  iOS and Android builds use local SQLite through Tauri; there is no sidecar.
  Backend routers and hooks run only on the web/server version. A plugin that
  must work in the apps does its work in the frontend, or calls a server of
  its own over the network (which makes it an opt-in add-on — see section 5).
- **No other mobile platform's name in UI text.** No "Android" in text the iOS
  or Mac app shows, and no "iOS", "iPhone" or "iPad" in text the Android app
  shows: App Review rejects it (guideline 2.3.10). Use neutral words ("phones
  and tablets", "the mobile app").
- Phones: don't rely on swipes from the bottom edge (they clash with the home
  gesture); reveal UI with a tap.
- **Dragging text out of the editor** works with a mouse, but touch web views
  (phones, tablets) rarely start a drag from selected text. Give every drag a
  tap or menu equivalent.
- **Drag and drop is HTML5 everywhere**, the desktop apps included: core turns
  Tauri's native drag-drop handler off, so plugin drop targets receive the
  normal `dragenter` / `dragover` / `drop` events. Files dropped on the window
  arrive as `dataTransfer.files`; a drop target that takes files calls
  `preventDefault()` on the drop, or core's window-level handler imports the
  file as a script.

---

## 5. Rules every plugin follows

- **Off-device data means opt-in.** Anything that sends the writer's words off
  the device (AI above all) sets `optIn: true` and a plain `privacy` sentence
  saying what leaves and where it goes. While an add-on is off, core withholds
  all of its menu items, panels, editor extensions, importers, exporters,
  reports, scene actions and grammar providers. Ask for settings (keys,
  addresses) in its `settings` screen, shown when the writer turns it on.
  OpenDraft never makes that choice for the writer, and neither does a default:
  an add-on with `settings`, or with `privacy` but not `staysOnDevice: true`,
  is never started by a manifest's or an administrator's default, or by a
  default of its own (`defaultEnabled: true` on the plugin, which applies when
  the writer has made no choice and no administrator or manifest default is
  set). Set `staysOnDevice` only when nothing it handles leaves the device.
  Sidekick, which every release builds in, sets neither: it is `optIn` with a
  privacy statement (it makes no network requests), so it stays off until the
  writer turns it on in Settings → Add-ons, like the other add-ons.
- **Translations.** `label`/`name` is the English default. To translate, call
  `addPluginResources('<plugin-id>', { en: {...}, es: {...} })` from
  `frontend/src/i18n` and set `labelKey: '<plugin-id>:menu.export'`. Resolve
  text when rendering, never at import time (getters, as the built-in add-ons
  do), so it follows the writer's language. `addPluginResources` is safe to
  call while registering: words added before the app starts i18next are held
  and applied as it starts.
- **Handle errors with a message.** A throw from `onActivate` leaves the add-on
  off and shows the message to the writer; a failing hook is only logged.
  Catch your own errors in components, importers and exporters and tell the
  writer what went wrong.
- **Don't fork core.** Never edit core to fit one plugin. A missing extension
  point is added to OpenDraft as a general-purpose hook, then used.
- **Commercial features stay out of OpenDraft.** They live in the host repo.

---

## 6. Working with the editor and panels

What building OD-Sidekick taught, in the order a plugin meets it. The
Sidekick's `src/script.ts` and `src/ui/` are the worked code.

### Panels

- **Fill the height and scroll inside.** The panel component gets a box the
  height of the window. Give its root `height: 100%`, `display: flex;
  flex-direction: column`, and let only the body scroll (`flex: 1;
  min-height: 0; overflow-y: auto`). A panel that grows with its content
  pushes everything after it off the screen.
- **Leave room for core's buttons.** Core draws its pop-out and close buttons
  over the panel's top end corner. Keep a fixed header with about `64px` of
  end padding, rather than scrolling content under them.
- **Don't set your own `z-index` or `position: fixed`** on the panel. Core
  makes it an overlay on narrow screens, keeps it under dialogs (z-index
  2900; dialogs are 3000) and clears the status bar on phones.
- **Use the theme.** Core's `--fd-*` variables (`--fd-text`,
  `--fd-text-muted`, `--fd-border`, `--fd-accent`, `--fd-input-bg`,
  `--fd-overlay-subtle` …) follow the light and dark themes. Text shown as
  it is on the page uses the page's own colours: `--fd-page-bg` and
  `--page-ink`.
- Open your panel with `document.dispatchEvent(new CustomEvent('plugin-panel:open',
  { detail: { panelId } }))`. Tell the writer something briefly with
  `showToast` from `@core/components/Toast`.
- A status-bar item should return `null` when it has nothing to say.

### Taking text from the script

- **Keep the element.** `state.doc.slice(from, to)` drops the paragraph's
  node when the selection stays inside one element, so a line of dialogue
  comes back as bare text. Pass `includeParents`:

  ```ts
  const slice = state.doc.slice(from, to, true);   // what ProseMirror's own drag uses
  const json = slice.toJSON();                      // { content, openStart, openEnd } — store this
  const back = Slice.fromJSON(editor.schema, json); // and rebuild with the script's schema
  ```

- **Store JSON, not HTML.** To show stored content with its formatting, build
  it with the script's own serializer — `DOMSerializer.fromSchema(editor.schema)
  .serializeFragment(Fragment.fromJSON(schema, content))` — never by setting
  `innerHTML` from stored data. It carries core's element classes, so core's
  screenplay CSS draws it; set `--script-scale` / `--indent-scale` on a
  wrapper to show it smaller. If the schema cannot read it (an element type
  the script no longer has), show the plain text.
- **Finding it again:** positions change with every edit, and an FDX or
  Fountain round trip renumbers everything. Search for the text, first in the
  scene it came from (a scene heading's `sceneUid` attr, then its heading
  text), and fall back to that scene's heading.
- ProseMirror reads the page's selection only **while the editor has focus**
  (this matters to tests that set a DOM selection by script).

### Putting text into the script

- Insert whole elements below the element the cursor is in, not into it. A
  stored slice that was "open" (selected from inside an element) re-inserted
  open is glued onto the neighbouring element:

  ```ts
  const nodes = Fragment.fromJSON(schema, stored.content);
  const at = state.selection.$to.after(1);          // after the top-level element
  const index = state.doc.resolve(at).index();
  if (state.doc.canReplace(index, index, nodes)) view.dispatch(state.tr.insert(at, nodes));
  else view.dispatch(state.tr.replaceRange(state.selection.to, state.selection.to, Slice.fromJSON(schema, stored)));
  ```

### Scrolling to a place in the script

`tr.scrollIntoView()` does **not** move OpenDraft's paginated, zoomable page,
and `view.focus()` can jump it. Select, focus without scrolling, then scroll
the page's container yourself — as core's scene navigator does
(`SceneNavigator.goToScene`):

```ts
view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
(view.dom as HTMLElement).focus({ preventScroll: true });
requestAnimationFrame(() => {
  const container = nearestScrollingAncestor(view.dom);   // the editor's scroll box
  const box = container.getBoundingClientRect();
  const top = container.scrollTop + (view.coordsAtPos(from).top - box.top) - container.clientHeight / 3;
  container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
});
```

### Drag and drop

- Drag and drop is HTML5 on every platform (section 4). A drop target calls
  `preventDefault()` on `dragover` to accept, and on `drop` calls both
  `preventDefault()` and `stopPropagation()` so core's file-import handling
  leaves it alone.
- Read a drag out of the script from `editor.view.dragging?.slice` first: it
  is exact, with marks. For a drag from elsewhere, parse `text/html` through
  the script's schema inside an inert `<template>`
  (`DOMParser.fromSchema(schema).parseSlice(template.content)`), then fall
  back to `text/plain`. A drop outside the editor copies; the script keeps its
  text.
- Show where a drop will land: light the target under the pointer, and
  outline the whole drop area while a drag is over it (count
  `dragenter`/`dragleave`, which fire for every child).
- **Every drag needs another way.** Touch screens rarely drag selected text,
  so offer a tap (tapping a target acts on the current selection) and a menu
  item.

### Menus and keys

- `shortcut` is only the text shown in the menu; write it the platform's way
  (`⌥⌘T` on Apple keyboards, `Ctrl+Alt+T` elsewhere). Bind the keys with a
  TipTap `Extension` in `editorExtensions` — key bindings only, never nodes
  or marks. Avoid combinations macOS takes (⌘⌥H hides other apps).
- Give a top-level menu item an `icon`, or it sits out of line with core's.
- `children` and `label` may be getters, so a submenu can follow the script
  (the Sidekick lists the script's own task types). `disabled` can be a
  function of `{ editor }`.

### Touch screens and phones

- Don't focus a text field by yourself on a touch screen: it raises the
  on-screen keyboard over the panel. Check `matchMedia('(pointer: fine)')`.
- Make targets bigger under `@media (pointer: coarse)` — about 38px high.
- Word help for the device: "drag it onto a type or tap one" with a mouse,
  "tap a type" on touch.

### Testing

- Unit-test against core itself: a fresh `new PluginRegistry()`, core's
  `src/test/setup.ts` as the setup file, and core's real schema from
  `src/test/screenplaySchema.ts` (`testSchema`, `block`) for anything that
  works on `EditorState`.
- Browsers under automation do not start a native drag of selected text from
  synthetic mouse input (WebKit and Chrome alike). Dispatch the drag events
  instead: `dragstart` on the selected text runs ProseMirror's real handler
  (it fills the `DataTransfer`), then `dragenter` / `dragover` / `drop` on
  your target with that same `DataTransfer`. Check the real gesture by hand
  in the desktop app before shipping.
- Core adds some text a moment after a script loads (automatic `(CONT'D)`),
  so compare element text with that left out, not the editor's `innerText`.
- OD-Sidekick's `test-script/e2e.mjs` runs the built app in Chrome without a
  server (request interception) and covers filing, a Fountain round trip,
  Go to, file drops and the phone layout. `test-script/runtime-e2e.mjs` does
  the same for the runtime plugin: plain core loading the folder, starting
  without it, and starting beside broken plugins. Core's
  `test-script/check_frontend_plugins.py` checks the server side in-process.

---

## 7. Examples to copy

- `frontend/src/addons/dictation/` — a complete opt-in add-on: right-sidebar
  panel, Tools menu item, settings form, translated text, per-platform privacy
  wording.
- `frontend/src/addons/ai-assistant/` — an opt-in add-on that talks to a
  server the writer chooses, with stored settings and error messages.
- `frontend/src/plugins/registry.test.ts` and `frontend/src/plugins/addons.test.ts`
  — unit tests against a fresh `new PluginRegistry()`, including add-on
  on/off behaviour and translations.
- **OD-Sidekick** (a sibling repo) — a complete frontend plugin built in with
  `OPENDRAFT_PLUGINS`: a right-sidebar panel that takes drops from the editor,
  a status-bar item, a Tools submenu, keyboard shortcuts, a report, an
  exporter, translations, and its data kept in the script with
  `setDocumentData`; plus unit tests against core and desktop/mobile builds.
- OpenDraft-Pro `plugins/call-sheets/` — the smallest host plugin layout
  (`frontend/index.ts` + `backend/router.py`).

A minimal plugin:

```ts
import { pluginRegistry, type OpenDraftPlugin } from '@core/plugins/registry';

const plugin: OpenDraftPlugin = {
  id: 'word-count-report',
  name: 'Word Count Report',
  version: '0.1.0',
  reports: [{
    id: 'word-count',
    label: 'Words per scene',
    build: ({ doc, title }) => ({
      title: `${title} — words per scene`,
      columns: ['Scene', 'Words'],
      rows: [], // walk `doc` (ProseMirror JSON) and fill this in
    }),
  }],
};

pluginRegistry.register(plugin);
```

---

## 8. Running and testing

- Host dev servers (Pro: `./start-pro.sh`): frontend on port 5174, backend on
  8008, with `/api` proxied from the frontend.
- Frontend unit tests: `npx vitest run` (core uses Vitest; `npm test` in
  `core/frontend`).
- Before shipping, open the editor on web, desktop and at least one mobile
  build if the plugin is meant to run there.
