# Feature Gap Plan — OpenDraft 2.7.1 vs the Market Leaders (Oct 2026)

Compared against **Final Draft 13**, **WriterDuet**, **Fade In**, **Arc Studio Pro**,
**Highland 2** and **Celtx**. Every "missing" item below was checked against the
code on `main` (2.7.1), not against `feature-gap-analysis-fade-in.md`, which was
written for v0.12 and is now mostly out of date (see §5).

Competitor capabilities are from public product information as known in 2026;
confirm details against each vendor's current docs before quoting them in
marketing or the README comparison table.

---

## 1. Where OpenDraft already stands (no work needed)

Already at or above parity, verified in code:

- Scene numbering with lock, A/B scenes, **Omit Scene**
- **Locked pages** with A pages and folded pages (`utils/lockedPages.ts`)
- Revision mode, revision colours, revision marks, colored pages, *PDF (Revised Pages Only)*
- Headers & footers with dynamic fields, Mores & Continueds, footnotes/endnotes
- Script Statistics (dialogue distribution, gender analysis, INT/EXT, locations,
  pacing, character-presence grid) and a Timing Report
- Table Read (TTS per character, several providers)
- Templates: feature, one-hour drama, multi-cam sitcom, stage play, radio play, podcast, AV
- Element numbering, title page editor, insert image, storyboard frames (AV)
- Customisable keyboard shortcuts (`utils/shortcuts.ts`, Settings)
- Import/export: FDX, Fountain, Fade In/OSF, DOCX, .odraft, AV formats; PDF export
- Beat Board, Index Cards, Treatment, Characters, Locations, Relationship Map, Tags
- Real-time collaboration, version history with diff, backups, multi-window
- Spelling, grammar, writing suggestions, handwriting input

---

## 2. Verified gaps

Legend — **Who has it**: FD = Final Draft, WD = WriterDuet, FI = Fade In,
AS = Arc Studio, HL = Highland, CX = Celtx.
**Effort**: S ≤ 1 week, M 1–3 weeks, L 3+ weeks (one developer).
**Repo**: Core (this repo, MIT) or Pro (OpenDraft-Pro), per `CLAUDE.md`'s open-core rules.

| # | Feature | Who has it | Status in OpenDraft | Effort | Repo |
|---|---------|-----------|---------------------|--------|------|
| 1 | **PDF import** | FD, WD, AS, HL, CX | Missing — and the README already claims "Import from … PDF" | L | Core |
| 2 | **Watermarked / password-protected PDF** | FD, WD, FI | Missing (no hits for `watermark`) | S | Core |
| 3 | **Sides & per-character printing** | FD, WD, FI, CX | Missing | M | Core |
| 4 | **Global character rename** | FD, WD, FI, AS | ✅ Done — `editor/characterRename.ts`, `RenameCharacterDialog` | S | Core |
| 5 | **Dialogue Tuner** (one character's lines, editable in one place) | FI, FD | Missing | M | Core |
| 6 | **Script bookmarks** | FI, FD | ✅ Done — `editor/extensions/Bookmark.ts`, `utils/bookmarks.ts` | S | Core |
| 4 | **Global character rename** | FD, WD, FI, AS | Missing — Find & Replace only | S | Core |
| 5 | **Dialogue Tuner** (one character's lines, editable in one place) | FI, FD | ✅ Done — `utils/dialogueTuner.ts`, `DialogueTuner` panel | M | Core |
| 6 | **Script bookmarks** | FI, FD | Missing (`bookmark` only refers to macOS file bookmarks) | S | Core |
| 7 | **Focus / typewriter mode** | FD, HL, AS, WD | Partial — *Menu & Toolbar → Hidden* exists; no typewriter scrolling, no dimming, no true full-screen | S | Core |
| 6 | **Script bookmarks** | FI, FD | Missing (`bookmark` only refers to macOS file bookmarks) | S | Core |
| 7 | **Focus / typewriter mode** | FD, HL, AS, WD | ✅ Done — `editor/extensions/FocusMode.ts`, View → Focus Mode | S | Core |
| 8 | **Writing goals, sprints & progress history** | FD (Goals), WD, HL (Sprint), AS | Missing | M | Core |
| 9 | **Alternates** (alternative lines/scenes kept beside the chosen one) | FD, AS, WD | Missing | M | Core |
| 10 | **Macros / text snippets** | FI, FD | ✅ Done — `utils/macros.ts`, Settings → Macros | S | Core |
| 11 | **Exportable reports** (scene, character, location, cast, breakdown → CSV/PDF) | FD, FI, WD, CX | Partial — stats are on screen only | S | Core |
| 12 | **Threaded comments** (replies, resolve, assign to collaborator) | WD, AS, CX | Partial — notes have colours and @asset refs, no threads or resolve | M | Core |
| 13 | **Story timeline / plotlines** (assign scenes to story threads, colour-coded timeline) | FD (Story Map, Structure Points), AS (Plot Board) | Missing | M | Core |
| 14 | **Suggest mode for collaborators** (proposed edits accepted/rejected by the owner) | WD, AS | Missing — track changes is against a check-in, not per-collaborator proposals | L | Core |
| 15 | **Dictation / speech to script** | FD (mobile), WD | Missing | M | Core |
| 16 | **Graphic novel / comic template** | FD, FI | Missing | S | Core |
| 17 | **Breakdown → schedule** (stripboard, shooting schedule, call sheets, DOOD) | CX, WD Pro, StudioBinder | Missing (tags exist) | L | **Pro** |
| 18 | **AI writing assistant** (bring-your-own-key, local model option) | AS, WD, CX | Missing | L | **Pro** |
| 19 | **Import from WriterDuet / Highland / Celtx native files** | — (switching aid) | Missing | M | Core |

Items 17 and 18 are commercial-grade features. Per the open-core rule they are
built in OpenDraft-Pro; the core only gains the plugin hooks they need (§4, phase 0).

---

## 3. Phased plan

Ordering principle: first close gaps that block **switching** (a writer can't
bring their scripts in) and **production use** (a script can't go out safely),
then the daily-writing features, then collaboration and planning depth.

### Phase 0 — Plugin hooks the later work needs (Core, S) — ✅ done

Shipped as `importers`, `exporters` and `reports` on `OpenDraftPlugin`
(`frontend/src/plugins/registry.ts`). The backend already had
`script:after_save`; exports happen in the client, so no backend export hook
was added — a server-side hook would never fire.

The registry (`frontend/src/plugins/registry.ts`) supports menu items, routes,
panels and editor extensions. Pro items 17–18 and some core items need three more
extension points, added here once instead of ad hoc later:

- `importers` — `{ extensions, label, parse(file) → JSONContent }`, consulted by
  `utils/importScreenplay.ts` and the File → Import menu
- `exporters` — `{ id, label, export(doc, ctx) → Blob }`, listed under File → Export
- `reports` — `{ id, label, build(doc) → rows }`, listed under Tools → Analytics and
  reusable by item 11

Backend: matching `register_hook` events in `backend/app/plugins.py` for
`script.saved` and `script.exported`.

**Done when:** a test plugin registers an importer, exporter and report and each
appears in the menu and runs; no core behaviour changes.

### Phase 1 — Switching & production blockers (4–6 weeks) — ✅ done

All four items shipped: PDF import (`utils/pdfImport.ts`), watermark and
password export (`PdfSecurityDialog`), sides and selected pages
(`SidesDialog`, `utils/pageSelection.ts`), and reports (`ReportsDialog`,
`utils/scriptReports.ts`). Not yet done from the descriptions below: the import
preview for bulk re-assigning lines, the 2-up sides layout, and *Print → only
pages with* (the same selection is available as a PDF export).

**1. PDF import** (L)
- Use `pdfjs-dist` to extract text runs with x/y positions per page.
- Classify each line by its left edge against the active template's element
  indents (`stores/formattingTypes.ts`), with fallbacks by content: ALL CAPS +
  INT./EXT. → Scene Heading, ALL CAPS ending `TO:` → Transition, `(…)` →
  Parenthetical, etc.
- Strip page furniture: page numbers, headers, `(MORE)`, `(CONT'D)`, revision
  asterisks; keep scene numbers as locked scene numbers if present.
- Detect dual dialogue from two character cues on the same y.
- Show an import preview where the writer can re-assign misclassified lines in
  bulk before committing.
- **Tests:** round-trip the existing golden scripts (`utils/__snapshots__/exportGolden/`)
  through our own `pdfExporter` → PDF import and diff element types; add a few
  third-party PDFs (Final Draft, WriterDuet, Highland output). Target ≥ 98 %
  element accuracy on our own PDFs.
- Fix the README claim now if this phase slips.

**2. Watermarked & password-protected PDF** (S)
- Extend `utils/pdfExporter.ts`: diagonal or footer watermark text using jsPDF
  `GState` opacity + rotated text, drawn on every page after content.
- Per-recipient batch: a list of names → one PDF per name (`OpenDraft – Jane Doe.pdf`).
- Password/permissions via jsPDF's built-in `encryption` option (no print, no copy).
- Export dialog gains a "Security" section; remembered per script.

**3. Sides & per-character printing** (M)
- Export → *Sides…*: pick scenes (or characters → their scenes), output keeps
  original page and scene numbers, crosses out/greys the parts of the page that
  are not in the chosen scenes, optional 2-up layout.
- *Print → Only pages with:* a character, a location or a tag.
- Builds on `pageBreaks.ts` / `lockedPages.ts` for page identity and
  `revisionPdf.ts`, which already emits a page subset.

**4. Exportable reports** (S)
- Scene, Character, Location, Cast and **Tag breakdown** reports as CSV and PDF,
  sharing the extraction in `utils/scriptStatistics.ts`.
- Breakdown CSV in a column layout scheduling tools accept, which is also the
  hand-off point for the Pro scheduling module (item 17).

### Phase 2 — Daily writing (4–5 weeks)

**5. Global character rename** (S) — ✅ done (`editor/characterRename.ts`,
`RenameCharacterDialog`; the Table Read voice travels with the profile). rename in Characters panel or context menu
on a cue: updates cues (keeping extensions like `(V.O.)`, `(CONT'D)`), the
character profile, tags, table-read voice assignment, and offers
"also replace in action/dialogue" as a reviewed list. One undo step.

**6. Dialogue Tuner** (M) — ✅ done (`utils/dialogueTuner.ts`, `DialogueTuner.tsx`). panel listing every line of one character in order,
with scene heading context; edits write straight back to the document (same
ProseMirror nodes, so collaboration and revision marks just work). Optional
"show the line before" for context. Read-aloud via the existing Table Read.

**7. Bookmarks** (S) — ✅ done as a `bookmark` attribute on the element
(`editor/extensions/Bookmark.ts`). Not yet mapped to FDX or Fountain; it rides
in `.odraft` and backups. Original plan: a mark/decoration with a name, a Bookmarks list in the
Navigator, `Go to Bookmark` in the Go to Page dialog; stored in the document so
collaborators share them; exported to FDX as ScriptNotes where possible.

**8. Focus & typewriter mode** (S) — ✅ done (`editor/extensions/FocusMode.ts`,
`services/fullscreen.ts`). View → Focus Mode: true full-screen (Tauri
`setFullscreen`, Fullscreen API on web), typewriter scrolling (caret line held at
a fixed height), optional dimming of all but the current element/scene. Reuses
the Hidden toolbar mode's reveal-on-hover.

**9. Macros / snippets** (S) — ✅ done (`utils/macros.ts`, `MacroSettingsSection`,
Edit → Insert Macro). user-defined text with an optional element type
and shortcut (via `utils/shortcuts.ts`), e.g. `CONTINUOUS`, `LATER`, a recurring
location. Stored in settings, exportable as JSON.

**10. Writing goals & sprints** (M) — daily/session word or page goals, a sprint
timer with a no-backspace option, and a local history of words written per day
(computed from save diffs, stored locally — no telemetry). Status bar progress
ring; a small calendar heat-map in Script Statistics.

### Phase 3 — Collaboration & story development (5–7 weeks)

**11. Threaded comments** (M) — notes gain `replies[]`, `resolved`, `author`,
`assignee`; "show resolved" toggle; collaborator @mentions through the collab
server's user list. Needs a schema bump in `.odraft` and the backend note model,
plus a migration for existing notes. Export resolved/unresolved to PDF notes.

**12. Alternates** (M) — on any dialogue or action element (and later whole
scenes), "Add Alternate" stores sibling versions; a chip in the margin cycles
them; only the active one prints/exports; FDX export picks the active one.
Store as a node attribute array so it rides through Yjs without new plumbing.

**13. Story timeline / plotlines** (M) — define plotlines (A-story, B-story,
character arcs) with colours; assign scenes and beats to them; a horizontal
timeline view showing scene length (from the timing engine) per plotline;
shared with Beat Board so beats and scenes stay linked.

**14. Suggest mode** (L) — collaborators with a "Suggest" role produce
insert/delete marks attributed to them; the owner accepts/rejects per change or
all. Reuse the mark machinery from `editor/trackChanges.ts`; enforce the role in
the collab server.

### Phase 4 — Reach (as capacity allows)

- **15. Dictation** — Web Speech API on web/desktop, platform speech on iOS/Android;
  voice commands for element changes ("new scene", "character Sarah").
- **16. Graphic novel template** — page/panel/caption/balloon elements,
  auto-numbered pages and panels (element numbering already supports this).
- **19. Competitor native imports** — WriterDuet `.wdz`, Highland `.highland`
  (zip containing Fountain), Celtx export — as `importers` from phase 0.

### Pro track (OpenDraft-Pro, in parallel, on the phase 0 hooks)

- **17. Production scheduling** — stripboard built from tags + timing, shooting
  schedule, Day-Out-of-Days, call sheets; reads the breakdown from item 4.
- **18. AI assistant** — bring-your-own-key or local model, off by default,
  never sends text without an explicit action: rewrite/punch-up a selection,
  coverage notes, logline/synopsis from the script, character voice check
  (pairs with the Dialogue Tuner).

---

## 4. Cross-cutting requirements for every item

- **Every format round-trips**: anything stored in the document (bookmarks,
  alternates, plotlines, comment threads) is carried by `.odraft` and backups,
  ignored safely by older versions, and mapped to FDX/Fade In where those
  formats have an equivalent.
- **Collaboration-safe**: stored as document nodes/marks/attrs so Yjs syncs them.
- **All platforms**: desktop, web, iOS, Android — check the mobile UI for each panel.
- **Tests**: unit tests beside the util (`*.test.ts`), golden export snapshots
  where output changes.
- **Docs**: user manual, `docs/FEATURES.md`, and "What's New" in `MenuBar.tsx`
  per `docs/RELEASE.md`.

---

## 5. Housekeeping

- Mark `docs/feature-gap-analysis-fade-in.md` as superseded by this file — most
  of its P1/P2 items (scene numbering & locking, page locking, omitted scenes,
  headers/footers, coloured revisions, statistics, table read, templates,
  shortcuts) have shipped.
- Fix the README's PDF import claim until item 1 ships, and add the new rows
  (Sides, Watermark, Dialogue Tuner, Alternates…) to its comparison table as
  each lands.

---

## 6. Suggested release mapping

| Release | Contents |
|---------|----------|
| 2.8 | Phase 0 hooks, Watermark/password PDF, Exportable reports, Character rename, Bookmarks |
| 2.9 | PDF import, Sides & selective printing, Focus/typewriter mode, Macros |
| 3.0 | Dialogue Tuner, Writing goals & sprints, Threaded comments, Alternates |
| 3.1 | Story timeline, Suggest mode |
| later | Dictation, Graphic novel template, competitor imports |
