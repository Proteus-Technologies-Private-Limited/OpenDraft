# Workspace layout, navigator and toolbar: plan

Source: GitHub Discussion #273 ("Some Ideas"). Mockups are on the design canvas "Navigator & Panel Layout".

## Principles

1. **Classic stays the default.** Existing installs open exactly as they do today. Every new arrangement is either a preset or a change the writer makes.
2. **One place to customise.** View › Customise Workspace… handles three things: dragging panels between the left dock, the right dock and Hidden; dragging items onto the toolbar and reordering them; and choosing where zoom goes. Presets switch the whole arrangement in one click.
3. **Edit where you look.** Scene colour and synopsis are edited inside the navigator row, with no dialog.

## Suggestions and proposals

| # | Suggestion | Proposal | Phase |
|---|---|---|---|
| 1 | Navigator on the right | Either dock can hold the Navigator. Drag its tab across, or pick the *Navigator right* preset | 2 |
| 2 | Other panels on the right (or left) | Every right-dock panel, plugin panels included, can go in either dock. Panels on the same side open as tabs, and a tab can split | 2 |
| 3 | Sluglines show "int." | Bug: the navigator shows the stored text, but the page shows capitals. Fix with `text-transform: uppercase` on the navigator heading | 1 |
| 4 | Font for navigator sluglines | *Heading font* option: Interface (new default) or Script (Courier) | 1 |
| 5 | Faster colour coding | Clicking the row's colour dot opens an inline swatch strip. Colour is also on the row's context menu | 1 |
| 6 | Easier synopsis | Click the synopsis to edit it in place. Enter or blur saves, Shift+Enter adds a new line, Esc cancels. The dialog stays for the duration override | 1 |
| 7 | All synopses readable, each collapsible | A chevron on each row, plus *Show all / Hide all*. Open rows are remembered per script | 1 |
| 8 | Page number per scene | A right-aligned page column from `pageLabels`, so locked labels such as 12A show | 1 |
| 9 | Zoom placement | Zoom slider, percentage and *Fit width* in the status bar. Toolbar zoom becomes an optional item and stays on in Classic | 3 |
| 10 | Toolbar buttons for panels | Customisable toolbar with an item registry, drag and drop from a palette, presets, and plugin items | 3 |
| 11 | Vertical spacing feels cramped | First measure line pitch against 6 lines per inch, side by side with Final Draft, and fix it if it's off. Then add a *Line spacing* option per template that shows the page-count change | 1 (measure), 4 |

## Phases

### Phase 1: Navigator quick wins
- `components/SceneNavigator.tsx`:
  - Replace `expandedSceneIdx: number | null` with a set of expanded scene ids.
  - Add a header button that toggles Show all / Hide all.
  - Add a page column, an inline swatch strip on the colour dot, and an inline synopsis editor.
  - Uppercase the heading.
- Move the swatch list out of `components/SynopsisModal.tsx` into a shared component, so the modal and the strip use the same one.
- Persist `navigatorHeadingFont` and the per-script expanded set. The font goes in the `ViewState` in `stores/editorStore.ts`, keyed by project for the expanded set.
- Save through the existing `updateSceneSynopsis` / `updateSceneColor`, so undo and collaboration behave as they do today.
- Measure line pitch at 100% zoom against Final Draft (Courier Final Draft and Courier Prime) and log the result. If it's off, fix it in `styles/screenplay.css` (`--screenplay-line-height`).

### Phase 2: Two dockable sides
- Add a layout model to `ViewState`:
  `workspace: { preset, docks: { start: PanelId[], end: PanelId[] }, active: { start, end }, split?: {...}, hidden: PanelId[] }`.
  It uses start/end rather than left/right, so right-to-left languages mirror.
- `components/ScreenplayEditor.tsx` renders both docks from this model instead of hard-coding the Navigator on the left and `FoldablePanelDock` on the right.
- Generalise `FoldablePanelDock.tsx` into a dock that renders tabs for any panel id. Keep its hinge behaviour on foldables.
- Drag tabs between docks with `@dnd-kit` (already used by BeatBoard and ProjectList).
- Presets: Classic, Navigator right, Everything right (Navigator and Notes split), Focus, plus presets the user saves.
- Plugin panels declare a `defaultDock` in `plugins/registry.ts`. This is a core extension-point change, so it belongs in this repo.
- Migration: a missing `workspace` key resolves to Classic.

### Phase 3: Toolbar and zoom
- Replace the fixed JSX order in `components/Toolbar.tsx` with a toolbar item registry (`id`, label, icon, render, `defaultPriority`). Keep the overflow logic, driven by the user's order: items at the end collapse first.
- Customise Workspace dialog, reached from View, the toolbar context menu and Settings.
- Status bar zoom in `components/StatusBar.tsx`, using `zoomLevel` / `setZoomLevel` from `editorStore`. The placement setting is `status | toolbar | both`.
- Add `toolbarItems` to `pluginRegistry` so Pro can contribute toolbar buttons.
- Each panel toggle opens its panel in whichever dock it lives in.

### Phase 4: Line spacing
- Write the template's `lineHeightMultiplier` into the page CSS (`utils/templateCss.ts`), so the screen matches pagination (`editor/pagination.ts:512`) and timing (`utils/scriptTiming.ts:149`), which already read it.
- Add Format › Template › Line spacing: Standard, Slightly open, Open and a fine slider, with a live preview and the page-count change before Apply.

## Phones, tablets and foldables
- Phones keep panels as sheets, and only the toolbar items carry over.
- Tablets get both docks.
- On foldables the dock follows the hinge, as it does today.

## Accessibility
- Every drag has a keyboard path: chips have Move left, Move right and Hide buttons, and palette items add on click.
- Colour swatches have accessible names.
- The synopsis editor is a real `<textarea>`.

## Out of scope
- Moving the centre views (Index Cards, Outline, Beat Board, Story Timeline) into docks. They stay as full-width views.
