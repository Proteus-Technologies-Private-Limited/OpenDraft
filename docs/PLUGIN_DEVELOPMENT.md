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
> OpenDraft is checked out at `core/` in this repo (git submodule).
>
> 1. Read `core/docs/PLUGIN_DEVELOPMENT.md` in full before writing code.
> 2. The contract is `core/frontend/src/plugins/registry.ts` (frontend) and
>    `core/backend/app/plugins.py` (backend). Import types from
>    `@core/plugins/registry`.
> 3. Do not edit anything under `core/`. If an extension point you need is
>    missing, stop and describe the hook that would be needed; it gets added to
>    OpenDraft as a general-purpose extension point.
> 4. The desktop and mobile apps have **no Python backend**. Anything that must
>    work there has to run in the frontend.
> 5. If the plugin sends any of the writer's text off the device, it must be an
>    opt-in add-on (`optIn: true`) with a `privacy` statement.
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
| `init`, `destroy` | Start-up work once a script is open; clean-up when the plugin is removed | `PluginContext` |
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

**When `init` runs.** Once per plugin: the first time a script's editor is
ready while the plugin is active. For an add-on that means once the writer has
turned it on; a plugin registered (or an add-on turned on) while a script is
already open starts straight away. Opening another script does not run it
again. `ctx.editor` always reads the editor open *now* (null between scripts),
so keep `ctx` and read `ctx.editor` when you need it — don't keep the editor
itself. A throw is logged and the other plugins still start. History views are
read-only and do not count as an open editor.

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
| panel `right-sidebar` | `components/PluginPanelTabs.tsx` | `{ editor }`; open one by dispatching `new CustomEvent('plugin-panel:open', { detail: { panelId } })` on `document` (`PLUGIN_PANEL_OPEN_EVENT`), close with `'plugin-panel:close'` and the same `detail` |
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

Copy what OpenDraft-Pro does. Its layout:

```
host/
  core/                         ← OpenDraft as a git submodule
  host-frontend/                ← Vite app: vite.config.ts, src/main.tsx, src/plugins.ts
  host-backend/                 ← FastAPI entry that imports core's app
  plugins/<id>/frontend/index.ts   ← default-exports an OpenDraftPlugin
  plugins/<id>/backend/router.py   ← exports `router` (optional)
```

### Frontend

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

---

## 5. Rules every plugin follows

- **Off-device data means opt-in.** Anything that sends the writer's words off
  the device (AI above all) sets `optIn: true` and a plain `privacy` sentence
  saying what leaves and where it goes. While an add-on is off, core withholds
  all of its menu items, panels, editor extensions, importers, exporters,
  reports, scene actions and grammar providers. Ask for settings (keys,
  addresses) in its `settings` screen, shown when the writer turns it on.
- **Translations.** `label`/`name` is the English default. To translate, call
  `addPluginResources('<plugin-id>', { en: {...}, es: {...} })` from
  `frontend/src/i18n` and set `labelKey: '<plugin-id>:menu.export'`. Resolve
  text when rendering, never at import time (getters, as the built-in add-ons
  do), so it follows the writer's language.
- **Handle errors with a message.** A throw from `onActivate` leaves the add-on
  off and shows the message to the writer; a failing hook is only logged.
  Catch your own errors in components, importers and exporters and tell the
  writer what went wrong.
- **Don't fork core.** Never edit core to fit one plugin. A missing extension
  point is added to OpenDraft as a general-purpose hook, then used.
- **Commercial features stay out of OpenDraft.** They live in the host repo.

---

## 6. Examples to copy

- `frontend/src/addons/dictation/` — a complete opt-in add-on: right-sidebar
  panel, Tools menu item, settings form, translated text, per-platform privacy
  wording.
- `frontend/src/addons/ai-assistant/` — an opt-in add-on that talks to a
  server the writer chooses, with stored settings and error messages.
- `frontend/src/plugins/registry.test.ts` and `frontend/src/plugins/addons.test.ts`
  — unit tests against a fresh `new PluginRegistry()`, including add-on
  on/off behaviour and translations.
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

## 7. Running and testing

- Host dev servers (Pro: `./start-pro.sh`): frontend on port 5174, backend on
  8008, with `/api` proxied from the frontend.
- Frontend unit tests: `npx vitest run` (core uses Vitest; `npm test` in
  `core/frontend`).
- Before shipping, open the editor on web, desktop and at least one mobile
  build if the plugin is meant to run there.
