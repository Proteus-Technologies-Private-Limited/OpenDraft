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
| 1 | **PDF import** | FD, WD, AS, HL, CX | ✅ Done — `utils/pdfImport.ts`, with an Import Preview for bulk re-typing (`PdfImportPreview`) | L | Core |
| 2 | **Watermarked / password-protected PDF** | FD, WD, FI | ✅ Done — `PdfSecurityDialog` | S | Core |
| 3 | **Sides & per-character printing** | FD, WD, FI, CX | ✅ Done — `SidesDialog`, 2-up (`utils/pdfTwoUp.ts`), File → Print Selected Pages | M | Core |
| 4 | **Global character rename** | FD, WD, FI, AS | ✅ Done — `editor/characterRename.ts`, `RenameCharacterDialog` | S | Core |
| 5 | **Dialogue Tuner** (one character's lines, editable in one place) | FI, FD | ✅ Done — `utils/dialogueTuner.ts`, `DialogueTuner` panel | M | Core |
| 6 | **Script bookmarks** | FI, FD | ✅ Done — `editor/extensions/Bookmark.ts`, `utils/bookmarks.ts` | S | Core |
| 7 | **Focus / typewriter mode** | FD, HL, AS, WD | ✅ Done — `editor/extensions/FocusMode.ts`, View → Focus Mode | S | Core |
| 8 | **Writing goals, sprints & progress history** | FD (Goals), WD, HL (Sprint), AS | ✅ Done — `utils/writingGoals.ts`, Tools → Writing Goals & Sprints | M | Core |
| 9 | **Alternates** (alternative lines/scenes kept beside the chosen one) | FD, AS, WD | ✅ Done — lines (`editor/alternates.ts`) and whole scenes (`editor/sceneAlternates.ts`) | M | Core |
| 10 | **Macros / text snippets** | FI, FD | ✅ Done — `utils/macros.ts`, Settings → Macros | S | Core |
| 11 | **Exportable reports** (scene, character, location, cast, breakdown → CSV/PDF) | FD, FI, WD, CX | ✅ Done — `ReportsDialog`, `utils/scriptReports.ts`, plus Notes and Open Notes | S | Core |
| 12 | **Threaded comments** (replies, resolve, assign to collaborator) | WD, AS, CX | ✅ Done — replies, resolve, assignee, @mentions, Notes report, replies merged by id in collaboration | M | Core |
| 13 | **Story timeline / plotlines** (assign scenes to story threads, colour-coded timeline) | FD (Story Map, Structure Points), AS (Plot Board) | ✅ Done — `utils/plotlines.ts`, `StoryTimeline`, beats linked to scenes (`utils/beatScenes.ts`) | M | Core |
| 14 | **Suggest mode for collaborators** (proposed edits accepted/rejected by the owner) | WD, AS | ✅ Done — `editor/suggestions.ts`, Suggest invite role, enforced by `collab-server/src/services/suggestionGuard.ts` | L | Core |
| 15 | **Dictation / speech to script** | FD (mobile), WD | Missing | M | Core |
| 16 | **Graphic novel / comic template** | FD, FI | ✅ Done — `stores/templates/comicTemplate.ts` | S | Core |
| 17 | **Breakdown → schedule** (stripboard, shooting schedule, call sheets, DOOD) | CX, WD Pro, StudioBinder | Missing (tags exist) | L | **Pro** |
| 18 | **AI writing assistant** (bring-your-own-key, local model option) | AS, WD, CX | In review — PR #180, to be repackaged as an opt-in add-on | L | Core add-on (advanced: Pro) |
| 19 | **Import from WriterDuet / Highland / Celtx native files** | — (switching aid) | ✅ Done — `highlandParser.ts`, `writerDuetParser.ts`, `celtxParser.ts`; `.wdz` is reverse-engineered and untested against a real file | M | Core |

Item 17 is a commercial-grade feature. Per the open-core rule it is built in
OpenDraft-Pro; the core only gains the plugin hooks it needs (§4, phase 0).

Item 18 was moved to the core on 2026-11-01, under one condition: **AI is an
add-on the writer chooses, never a built-in.** A basic assistant may ship in the
core, but only as an opt-in plugin (`optIn: true` in `plugins/registry.ts`). It
is off until the writer turns it on in Settings → Add-ons, asks for its
settings when turned on, says what leaves the device before it is turned on, and
contributes nothing — no menu item, toolbar button, panel or network call —
while off. Pro may offer a more advanced assistant on the same mechanism.

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
`utils/scriptReports.ts`). The follow-ups are done too: the Import Preview for
bulk re-assigning lines (`PdfImportPreview`, `utils/pdfImportReview.ts`), the
2-up sides layout (`utils/pdfTwoUp.ts`), and *File → Print Selected Pages…*,
which prints the same selection through the PDF on every platform (on Android
the print dialog opens on landscape paper for 2-up sheets).

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
(`editor/extensions/Bookmark.ts`). Carried natively by FDX (`Bookmark=` on the
paragraph) and Fade In/OSF (`bookmark=`), and as a `[[Bookmark: …]]` note in
Fountain (`utils/formatAnnotations.ts`); it also rides in `.odraft` and backups. Original plan: a mark/decoration with a name, a Bookmarks list in the
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

**10. Writing goals & sprints** (M) — ✅ done (`utils/writingGoals.ts`,
`stores/writingGoalsStore.ts`, `hooks/useWritingTracker.ts`; counted from the
script a few seconds after typing stops rather than from save diffs, so the
ring is live and autosave settings don't matter). daily/session word or page goals, a sprint
timer with a no-backspace option, and a local history of words written per day
(computed from save diffs, stored locally — no telemetry). Status bar progress
ring; a small calendar heat-map in Script Statistics.

### Phase 3 — Collaboration & story development (5–7 weeks)

**11. Threaded comments** (M) — notes gain `replies[]`, `resolved`, `author`,
`assignee`; "show resolved" toggle; collaborator @mentions through the collab
server's user list. Needs a schema bump in `.odraft` and the backend note model,
plus a migration for existing notes. Export resolved/unresolved to PDF notes.

✅ **Done.** Script and general notes both carry `author`, `replies[]`,
`resolved` / `resolvedBy` / `resolvedAt` and `assignee` (`utils/noteThreads.ts`),
with Reply, Resolve / Reopen and an assignee pulldown on every card
(`components/NoteThread.tsx`), a *Show resolved* toggle, a *For me* filter, and
`@` mentions of collaborators, drawn from who is connected, the collab server's
invite list for the script and everyone already named in its notes. Resolved
notes fade to a dashed underline in the script. Exporting notes with their
status (a Notes report in Tools → Analytics → Reports) is a separate change.
Two departures from the description above:
- **No schema bump or backend change.** Notes ride in the saved script as the
  `_notes` / `_generalNotes` JSON, which the backend stores without reading, so
  the new fields are optional and additive: absent reads as open, unassigned and
  without replies, and older versions keep them through an edit. The migration
  is `normalizeNoteThread` on every load path (`setNotes`), which leaves a
  legacy note untouched and repairs malformed thread data.
- **Collaboration is last-writer-wins per notes list**, as all note metadata
  already is (`services/collabSync.ts`). Two replies posted within the same
  sync round trip could lose one. ✅ Now merged by id (`mergeNoteLists` in
  `utils/noteThreads.ts`), with deletions kept as tombstones in their own Yjs
  map so a merge never brings a deleted reply back. Concurrent edits to one
  note's text, colour or assignee are still last-writer-wins.

**12. Alternates** (M) — on any dialogue or action element (and later whole
scenes), "Add Alternate" stores sibling versions; a chip in the margin cycles
them; only the active one prints/exports; FDX export picks the active one.
Store as a node attribute array so it rides through Yjs without new plumbing.

✅ **Done for dialogue and action** (`editor/alternates.ts`,
`editor/extensions/Alternates.ts`). The element's own text is the version in
use and the others sit in its `alternates` attribute, so every exporter, the
page count and the reports see only the active version without changes. Add
Alternate, Next / Previous, Delete This Version and Keep Only This Version are
on the right-click menu; the margin chip steps through versions. Whole scenes
are the remaining step. Older versions of the app drop the attribute when
they save, keeping the active version.

**13. Story timeline / plotlines** (M) — define plotlines (A-story, B-story,
character arcs) with colours; assign scenes and beats to them; a horizontal
timeline view showing scene length (from the timing engine) per plotline;
shared with Beat Board so beats and scenes stay linked.

✅ **Done** (`utils/plotlines.ts`, `utils/storyTimeline.ts`,
`components/StoryTimeline.tsx`). Plotlines are saved as `_plotlines` and synced
in collaboration; a scene's plotlines are a `plotlines` attribute on its scene
heading, so they move with the scene; a beat lists its own (`plotlineIds`).
View → Panels → Story Timeline shows one row per plotline with scenes as wide
as their screen time; click to assign. Beat cards get a plotline picker and
the Scene Navigator shows a dot per plotline. ✅ Beats now link to scenes too
(`utils/beatScenes.ts`, through a stable `sceneUid` on the scene heading): the
card shows the linked scenes and jumps to them, and the timeline has a Beats
row. Plotlines have no equivalent in FDX, Fade In or Fountain, so they stay in
`.odraft`.

**14. Suggest mode** (L) — collaborators with a "Suggest" role produce
insert/delete marks attributed to them; the owner accepts/rejects per change or
all. Reuse the mark machinery from `editor/trackChanges.ts`; enforce the role in
the collab server.

✅ **Done**, with one change of plan: `editor/trackChanges.ts` turned out to be a
diff against a check-in drawn as decorations, with no marks to reuse, so
suggestions have their own model (`editor/suggestions.ts`):
- `suggestionInsert` / `suggestionDelete` marks on text, and `suggestedSplit`,
  `suggestedJoin` and `suggestedType` stamps on elements, each `{ id, by, at }`.
  All are document content, so they save, sync through Yjs and survive reload.
- While suggesting, the view's dispatch is wrapped (`editor/extensions/
  Suggestions.ts`) and each edit is rewritten: deletions are struck instead of
  removed, insertions marked, a suggester's own suggestions really undone.
  Remote changes, undo and its own transactions pass through.
- Accept and reject per suggestion or for everything shown, in the Suggestions
  panel or on the right-click menu. Accepting is what marks a revision.
- Roles: `suggester` beside `editor` and `viewer`, whitelisted at invite time.
  The collab server checks each update from a suggester in
  `beforeHandleMessage` (`services/suggestionGuard.ts`) by comparing the script
  before and after, unit by unit, and closes the connection on anything that is
  not the author's own suggestion; viewers now get a read-only connection.
- Not suggestible yet: formatting, and an inline line break (y-prosemirror does
  not store marks on inline nodes). Panels other than the script — notes,
  beats, characters — sync as they do for any collaborator.
- Exports, print, sides and linked files leave pending suggestions out
  (`withoutSuggestionsJSON`); `.odraft` keeps them.

### Phase 4 — Reach (as capacity allows)

- **15. Dictation** — Web Speech API on web/desktop, platform speech on iOS/Android;
  voice commands for element changes ("new scene", "character Sarah").
- **16. Graphic novel template** — ✅ done: the *Comic Book* format
  (`stores/templates/comicTemplate.ts`) — pages in words, panels restarting per
  page, captions and balloons lettered across the page.
- **19. Competitor native imports** — ✅ done as built-in formats rather than
  plugins: Highland `.highland` (a zipped TextBundle around Fountain), Celtx
  `.celtx` (RDF manifest + HTML script) and WriterDuet `.wdz` (an operation log
  in `script.json`, reverse-engineered; no real file tested yet).

### Pro track (OpenDraft-Pro, in parallel, on the phase 0 hooks)

- **17. Production scheduling** — stripboard built from tags + timing, shooting
  schedule, Day-Out-of-Days, call sheets; reads the breakdown from item 4.
- **18. Advanced AI assistant** (the core gets a basic opt-in add-on; see §2) —
  bring-your-own-key or local model, off by default,
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
| 2.8 | Everything in phases 0–3 except Suggest mode, plus the graphic novel template and competitor imports — all on `main`, unreleased as of 29 Oct 2026 |
| 2.9 | Suggest mode (item 14) |
| later | Dictation (item 15) |

Follow-ups (Suggest mode is merged; dictation remains open):
- **Privacy policy:** note authors, replies, resolution and assignments stay out of
  FDX/Fade In/Fountain exports. Printing a note shares only its body in supported
  exports, not its discussion. Keep `.odraft` for the full thread. Regression
  coverage: `utils/exportFootnotes.test.ts`.
- **Compatibility warning added:** the in-app, manual and iOS/macOS store release
  notes warn that saving in an older version drops bookmarks, alternates,
  plotlines and beat-scene links. Keep an `.odraft` backup before doing so.
- **WriterDuet validation still blocked:** `.wdz` tests use reconstructed
  fixtures. A genuine non-confidential WriterDuet export and an FDX export of
  the same script are needed to compare text, element order, title page and
  formatting. Do not treat the synthetic tests as real-file validation.
- **Concurrent alternates workaround:** adding, switching or deleting line and
  scene versions is blocked during live collaboration, before the transaction
  changes either active text or stored versions. The shown version remains
  editable. End the session to change versions. This prevents simultaneous
  switches from duplicating text; it does not redesign y-prosemirror's
  replacement semantics. Older clients do not have the guard, so all session
  participants should update. A shared active-version model remains future work.
