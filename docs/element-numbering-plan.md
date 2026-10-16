# Element Numbering — Phase 1 Plan

Number elements other than scene headings (dialogue, SFX cues, shots, any
custom element), with the format deciding which elements are numbered and what
restarts each count.

**Origin:** user feedback (2026-10). A podcast writer wants every line of
dialogue numbered, so a recording session can follow along. Final Draft offers
this under Production → Scene Numbers, with an Element picker and "Restart
numbering every …" ([KB](https://kb.finaldraft.com/hc/en-us/articles/15575278457492-I-want-to-number-other-elements-such-as-shots-characters-or-dialogue)).

**Scope:** core (MIT). Brings OpenDraft level with the scene numbering it already has.

**Status:** Phase 1 built on branch `feature/element-numbering` (2026-10-16).
Where the build differs from this plan, the section says so and §13 lists
every difference.

---

## 1. Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | Numbering is set **per element in the format** (`FormattingElementRule.numbering`) | Formats already own per-element behaviour (next-on-Enter, AV cell, format override). A Podcast format can ship with numbered dialogue already set up. |
| D2 | A count restarts at **elements only** (`resetOn: string[]`), never at page breaks | Page breaks fall in different places in the editor, PDF and Word. Resetting at elements gives the same number everywhere. |
| D3 | Every numbered element has **its own counter** | Dialogue can restart every scene while SFX cues run through the whole script. |
| D4 | Phase 1 numbers are **computed, not stored** | They are worked out from document order and drawn as ProseMirror decorations. No schema change and no migration, and collaborators on the same format see the same numbers. |
| D5 | **Scene headings keep their own system** (`utils/sceneNumbers.ts`) | Locking, 12A/A1 and OMITTED stay as they are. A scene heading can still *trigger* a reset, but it can't be numbered by this system. |
| D6 | A per-document **Show Element Numbers** toggle | The format decides *what* gets numbered; the writer can hide numbers for a reading draft without switching formats. |
| D7 | **Locked element numbers wait for Phase 2** | They need stored attributes on every node type that can be numbered. Phase 1 has to prove demand first. |

---

## 2. Data model

### 2.1 Format rule (`frontend/src/stores/formattingTypes.ts`)

```ts
/** Running numbers on an element (dialogue 1, 2, 3… / SFX 1, 2…). */
export interface ElementNumbering {
  enabled: boolean;
  /** Element ids (rule ids, custom ones included) that restart the count. [] = never. */
  resetOn: string[];
  /** Printed before the number: "SFX " → "SFX 4". Default ''. */
  prefix?: string;
  /** First number after a reset. Default 1. */
  startAt?: number;
  /** 'plain' → 3 ; 'scene' → 12.3 (scene number, then the count). Default 'plain'. */
  style?: 'plain' | 'scene';
}

export interface FormattingElementRule {
  // …existing fields…
  /** Absent = not numbered. */
  numbering?: ElementNumbering;
}
```

The field is optional, so formats saved before it existed load unchanged.
`withMissingRules` in `formattingTemplateStore.ts` needs no change.

**Elements that can't be numbered:** `sceneHeading` (it has its own system),
title-page rules, `avBlock`, and outline-only rules (section, synopsis).
`numberableElementIds()` returns this list; the format editor and the counter
both use it.

**Elements that can trigger a reset:** any enabled element, including
`sceneHeading`, `newAct`, `endOfAct`, `section`, `showEpisode` and custom
elements.

`style: 'scene'` needs a scene number. Before the first scene heading, or with
scene numbers turned off, it falls back to `plain`.

### 2.2 Document setting

Saved next to `_sceneNumbersVisible` and loaded the same way. That means
`editorStore`, the `saveContent.ts` key list, `hydrateStores.ts`,
`importScreenplay.ts`, and the snapshot in `ScreenplayEditor.tsx:3341`.

```
elementNumbersVisible: boolean   // default true; persisted as _elementNumbersVisible
```

It defaults to **true** so that choosing a numbered format shows the numbers
straight away. *As built:* `_elementNumbersVisible` is written **only when it
is false**, so a script that never hides the numbers saves byte for byte as
before. A missing key reads as shown, and loading a script always sets the
flag, so one script never inherits another's hidden numbers.

---

## 3. The counter — `frontend/src/utils/elementNumbers.ts` (new)

A pure function with no editor and no store, so it can be unit-tested directly
and every exporter calls the same code.

```ts
export interface NumberedNode { type?: string; attrs?: Record<string, unknown> | null }

/**
 * The label each numbered element should carry, in document order.
 * Returns a map from the node's index in the flattened walk to its label ("SFX 4", "12.3").
 */
export function assignElementNumbers(
  nodes: NumberedNode[],
  rules: Record<string, FormattingElementRule>,
): Map<number, string>
```

How it works:

- It walks the nodes in document order and gets each node's id with
  `elementIdOf()` from `utils/pageBreaks.ts`, so custom elements resolve to
  their rule id.
- It keeps one counter per numbered element. Before an element counts itself,
  any counter whose `resetOn` lists that element's id is reset to
  `startAt - 1`.
- **Dual dialogue:** the left column counts before the right, which matches the
  reading order in `utils/dualDialogue.ts`.
- **AV blocks:** the walk skips them. AV shots are already numbered by
  `AvCueDecorations`.
- **Empty elements** (a blank dialogue line still being typed) aren't counted,
  so numbers don't jump while someone writes.
- **Notes:** a note's contents never count.
- **Omitted scene headings** still reset the count; the heading is still in
  the script.

`getElementNumberingRules()` reads the active format and returns only the rules
whose numbering is turned on. It follows the `getForceBreakIds()` pattern:
it never throws, and it returns `{}` when the template store hasn't loaded
yet (tests, headless export).

---

## 4. Editor display

**Plugin:** `frontend/src/editor/extensions/ElementNumbers.ts` (new), modelled
on `AvCueDecorations` in `AvBlock.ts`.

- On each doc change, or when the active format or the visibility toggle
  changes, the plugin recomputes the labels for the whole doc and publishes
  them as `Decoration.node(pos, end, { 'data-element-number': label })`.
- It does nothing when no rule has numbering turned on, which is the case for
  most scripts.
- **Performance:** the walk is O(nodes), the same cost as `updateScenes`. If
  profiling on a 120-page script calls for it, rebuild only when a transaction
  touches a numbered element or a reset element. Otherwise map the old
  decorations through the transaction.
- **Format changes:** the plugin listens for meta from a small
  `useEffect` in `ScreenplayEditor.tsx`, which dispatches a meta-only
  transaction when `activeTemplateId`, the active format's rules or
  `elementNumbersVisible` change.

**CSS** (`styles/screenplay.css`, next to the scene-number block at line 2217):

```css
.show-element-numbers [data-element-number]::before {
  content: attr(data-element-number);
  float: left;
  width: 1in;
  margin-left: calc(-1in - 0.15in);   /* margin box narrower than nothing */
  text-align: right;
  /* …no weight, style, transform or pointer events */
}
```

*As built:* a float, **not** absolute positioning. Absolute positioning needs
`position: relative` on the element. In browser print, the revision asterisk
(`.rev-mark::before`) is placed with `left: calc(100% + 0.65in)` against the
nearest positioned ancestor, so every asterisk inside a numbered dialogue would
have moved from the right margin into the text column. The float's negative
margin is larger than its width, so it shortens no line and the element wraps
exactly as pagination counted.

- No element other than the scene heading uses `::before`/`::after` today, so
  there is no conflict.
- Numbers go **on the left only**. The right margin holds revision marks and
  the right-hand scene number.
- The number sits right next to the element's own left indent, not at the
  page edge. That's deliberate: a dialogue number at 2.5″ reads as belonging to
  that line. Confirm this choice in the visual check (§8).
- The `.show-element-numbers` class goes on `.page` next to
  `show-scene-numbers` (`ScreenplayEditor.tsx:4975`).

Browser printing uses the same CSS, so it works with no extra code.

---

## 5. Format editor (`frontend/src/components/TemplateEditorDialog.tsx`)

A **Numbering** section in the per-element panel, shown only for elements that
can be numbered:

- [ ] **Number this element** (`enabled`)
- **Restart at:** checkboxes for every enabled element that can trigger a reset (`resetOn`)
- **Prefix:** text field, max 12 characters
- **Start at:** number field, at least 0
- **Style:** Plain (`3`) / With scene number (`12.3`)

A preview line under the controls shows the result, e.g. `SFX 1, SFX 2 … ↺ at Scene Heading`.

System formats are read-only, as they are today. A writer who wants different
numbering duplicates the format first. The existing duplicate path already
copies `rules` in full.

---

## 6. Menu

Under Tools → Production, below the scene-number entries
(`MenuBar.tsx:2912`):

- **✓ Show Element Numbers**. It is disabled, with a tooltip saying the
  format has no numbered elements, when the active format has none.
- **Element Numbering…** opens the format editor at the first numbered
  element, or at Dialogue if none is numbered yet. *As built:* it opens the
  Formatting Template dialog, the existing way into the format editor.
  Jumping straight to an element would need new props on both dialogs.

---

## 7. Export

Every exporter takes `elementNumbersVisible` in its options, as it does
`sceneNumbersVisible`, and calls `assignElementNumbers` on the same JSON it
already walks.

| Format | Behaviour | Where |
|--------|-----------|-------|
| **PDF** | Draws the label in the left margin, on the baseline of the element's first line, right-aligned 0.15″ before the element's left indent. If a dialogue block splits across pages, the label goes only on the first part, never after the CONT'D. Dual dialogue: one label per column, each before its own column. | `pdfExporter.ts`, next to the scene-number drawing at ~line 1344 |
| **FDX** | `Number="…"` on the `<Paragraph>`, the attribute Final Draft uses for any numbered element. Check in Final Draft that it displays. | `fdxExporter.ts` ~line 523 |
| **DOCX** | The label goes first, as its own run plus a tab, using a hanging indent so the text column doesn't move. Word paginates as usual (see the "No Hard Pagination in DOCX" decision). | `docxExporter.ts` |
| **Fountain** | Dropped. Fountain has no syntax for numbers on anything except scenes. | — |
| **OSF / .odraft** | Nothing extra to write. The numbers come back from the format when the file is reopened. | — |
| **Linked files** | Pass the flag through in `linkedFileFormat.ts`, as `sceneNumbersVisible` is. | `linkedFileFormat.ts:138` |

**FDX import:** `fdxParser.ts:449` puts `Number` onto `attrs.sceneNumber` for
*every* paragraph. Only `sceneHeading` declares that attribute, so the value is
silently dropped everywhere else. **Keeping imported numbers exactly as Final
Draft wrote them needs stored numbers, so it belongs to Phase 2.** Until then,
an imported script shows numbers only when its format numbers that element.

*As built: the parser is not changed.* A script imported and saved before the
editor ever opens it still holds Final Draft's number on the paragraph as raw
JSON, and FDX export writes it back. Scoping the parser would have quietly
lost that. The risk worth guarding was the opposite one: a paragraph carrying
both that stray number and a computed one would write two `Number` attributes,
which is invalid XML. `emitParagraph` now writes the element number in place
of the stray one, and a test covers it.

*As built:* **exporting saved content** (Project view's export, linked files)
takes the numbering from **the script's own `_templateId`**
(`labelSavedContent` in `utils/elementNumbers.ts`), not from the active
format, which may belong to a different open script. Exporters print any
`elementNumber` label on the JSON they are given, so these callers label the
document first. For a centred or right-aligned element, DOCX writes the number
in front of the text, because there is no left edge to hang it from.

---

## 8. Tests

Unit tests (vitest):

- `utils/elementNumbers.test.ts`: plain run; reset at scene heading; several
  reset elements (scene heading *or* new act); independent counters for
  dialogue and SFX; prefix; `startAt` 0 and 5; `scene` style with scene
  numbers on, off, and before the first heading; dual dialogue order; AV block
  skipped; empty element not counted; custom element counted and used as a
  reset trigger; omitted scene heading still resets; no rules returns an empty
  map.
- `editor/elementNumberDecorations.test.ts`: inserting a dialogue line above
  others renumbers every line below it (the sibling-staleness bug
  `avCueDecorations.test.ts` guards against); switching formats redraws the
  numbers.
- `stores/formattingTemplateStore` test: a format saved without `numbering`
  loads unchanged, and duplicating a format keeps `numbering`.
- Exporter tests: in PDF, a split dialogue block gets its label once; FDX
  writes `Number` on numbered paragraphs; DOCX writes the label run.

Manual check (dev server plus an unsigned macOS build): a Radio Play copy with
dialogue numbered and reset at Scene, ~30 pages. Check the editor, print, PDF,
DOCX in Word, and FDX opened in Final Draft.

---

## 9. Protecting existing features

The rule: **a script whose format numbers no elements behaves exactly as it
does today, byte for byte in every export.** All built-in formats and every
saved format are in that state on day one.

### 9.1 What the design keeps out of reach

| Existing feature | Why it can't be disturbed | Proof |
|------------------|--------------------------|-------|
| **Document content, saved files, undo history** | No schema change (D4). Numbers are decorations, so they never enter the doc JSON, `.odraft`, undo history or autosave. | §9.2 golden test, run on save output |
| **Real-time collaboration** | Decorations are local to each view and never sent over the network. The document sync sees no new steps. | Two-client manual check |
| **Pagination / page breaks / locked pages** | The label is absolutely positioned in the editor and drawn in the margin in PDF, so it adds no height. `pagination.ts` and the PDF layout pass never see it. | Test: identical break positions with numbering on and off (§9.3) |
| **Scene numbers** (show, lock, 12A/A1, OMITTED, navigator) | `utils/sceneNumbers.ts` and `updateScenes` are not touched. Scene headings are excluded from element numbering (D5). | Existing `sceneNumbers.test.ts` and `omitScene.test.ts` unchanged and passing |
| **Revision marks** | Element numbers use the left margin only. Revision asterisks and the right scene number keep the right margin. | Visual check with Revision Mode on |
| **(MORE)/CONT'D, dual dialogue, AV blocks** | Labels are drawn after layout and never change line wrapping. AV blocks are skipped by the counter. | PDF tests: split dialogue, dual dialogue, AV script |
| **Saved formats** (local SQLite, backend, cloud copy) | `numbering` is optional. The backend stores `rules` as a free `dict` and SQLite as JSON text, so it round-trips with no migration, and older app versions ignore it. | Format store test (§8) |
| **Format editor for existing elements** | The Numbering section is new and shown only for elements that can be numbered. No existing control moves or changes meaning. | Manual check of every system format |
| **FDX import** | *As built:* the parser is not touched. Export writes an element number in place of a stray imported one, never both. | Existing `fdxParser` and FDX round-trip tests unchanged and passing; the duplicate-`Number` test |
| **DOCX layout** | The hanging-indent change is applied **only** to numbered paragraphs. Unnumbered paragraphs keep their current properties exactly. | DOCX golden test (§9.2) |
| **Editor performance** | With no numbered rule, the plugin returns before walking the doc. | Typing-latency check on a 120-page script with numbering off and on |

### 9.2 Golden-output tests (before any feature code)

1. Add `utils/exportGolden.test.ts` as the **first commit**. It exports a set of
   existing fixtures to FDX, Fountain, DOCX (`document.xml`), PDF (text and
   position stream) and OSF, and saves the results as snapshots.
   - **Fixtures:** feature film, multi-cam sitcom, radio play, AV script,
     dual dialogue, revisions on, locked pages, and locked + omitted scene
     numbers.
2. All later commits must leave those snapshots **unchanged**. The format has
   no numbered rule, so any diff is a regression.
3. A second set of snapshots covers the same fixtures with numbering on, to
   catch accidental changes to the new behaviour.

### 9.3 Layout-invariance test

For each fixture, compare the page-break positions from `pagination.ts` and
the PDF page count with numbering off and with dialogue numbering on. They must
be identical, which proves the label never takes up space.

### 9.4 Before merge

- [ ] Full `npm test` passes, with the existing suite unmodified (no updated
      expectations except the new snapshots).
- [ ] `npm run build` and type-check are clean.
- [ ] Manual pass on the dev server with numbering **off**: open existing
      scripts in every system format, then export PDF/FDX/DOCX/Fountain and
      diff them against the same exports from `main`.
- [ ] The same pass with numbering **on**, plus two-client collaboration and
      browser print.
- [ ] Unsigned macOS build opened on an existing local project, to cover
      SQLite-stored formats.

---

## 10. Built-in format defaults

The question here is whether **Radio Play** should ship with numbering on.

- Recommendation: leave Radio Play as it is, and add numbering to its
  `starterDocument` users only through a new **Podcast** format (scriptTypeGroup
  "Audio"). **Decided 2026-10-16: new Podcast format.**
- The Podcast format would number dialogue with `resetOn: []`, and SFX and
  Music cues with prefixes `SFX ` and `MUSIC `. *As built:* prefixes `FX `
  and `MX `, the usual cue-sheet labels, because the cue text itself already
  begins `SFX:` or `MUSIC:`. Built from the Radio Play rules
  (`stores/templates/podcastTemplate.ts`).
- This keeps existing Radio Play scripts from suddenly showing numbers.


---

## 11. Out of scope (Phase 2 and later)

- **Locked element numbers** (12A-style inserts) and **editing a single
  element's number** (Final Draft's "Edit Scene Number" on any line). Both need
  a stored `elementNumber` attribute on every node type that can be numbered.
- **Keeping FDX numbers on import,** which depends on the stored attribute.
- **Page-based resets** (D2).
- **Carrying numbering to other devices.** A document saves only
  `_templateId`. A custom format with numbering is local to the machine it was
  made on, so it doesn't reach collaborators or other devices. Custom elements
  already have this limitation; fixing it means embedding a snapshot of the
  format in the document, which is a separate project.
- **Numbering in the Scene Navigator, Index Cards and Table Read** (the TTS
  could announce "line 12").

---

## 12. Rough order of work

0. Golden-output snapshots of current exports (§9.2) — committed before any feature code.
1. Type, `numberableElementIds`, `assignElementNumbers` and its tests.
2. Editor plugin, CSS, document toggle, persistence and the menu.
3. Numbering section in the format editor.
4. PDF, then FDX, then DOCX export, with tests.
5. ~~FDX parser scoping fix~~ (replaced by the duplicate-`Number` guard, §7).
6. Podcast format (if approved), plus the user manual, What's New and FEATURES.md.

---

## 13. As built (2026-10-16)

| Area | Files |
|------|-------|
| Type | `stores/formattingTypes.ts` (`ElementNumbering`, `FormattingElementRule.numbering`) |
| Counter, rules, export labelling | `utils/elementNumbers.ts` |
| Editor | `editor/extensions/ElementNumbers.ts`, registered and refreshed in `components/ScreenplayEditor.tsx`; CSS in `styles/screenplay.css` |
| Document setting | `stores/editorStore.ts`, `utils/saveContent.ts`, `utils/hydrateStores.ts`, `ScreenplayEditor.tsx` load path |
| Menu | `components/MenuBar.tsx` (Tools → Production) |
| Format editor | `components/TemplateEditorDialog.tsx` |
| Export | `utils/pdfExporter.ts`, `utils/fdxExporter.ts`, `utils/docxExporter.ts`; callers in `MenuBar.tsx`, `ProjectView.tsx`, `utils/linkedFileFormat.ts` |
| Podcast format | `stores/templates/podcastTemplate.ts`, registered in `stores/formattingTemplateStore.ts` |
| Tests | `utils/exportGolden.test.ts` (+ `utils/__snapshots__/exportGolden/`), `utils/elementNumbers.test.ts`, `editor/elementNumberDecorations.test.ts`, `stores/activeTemplateIdentity.test.ts` |
| Docs | `user-manual/formatting.html#element-numbering`, `user-manual/scene-navigator.html`, `user-manual/manifest.json`, `docs/FEATURES.md` |

Differences from the plan: §2.2 (save key only when hidden), §4 (float, not
absolute), §6 (menu opens the template dialog), §7 (parser unchanged,
duplicate guard instead; saved content uses its own format; DOCX centred
elements), §10 (FX/MX prefixes). AV paragraph types (`avPara`, `avShot`,
`avDirection`, `avGraphic`) can't be numbered or trigger a reset, because they
exist only inside AV cells.

**Found along the way, not fixed here:** the Word export drops dual dialogue
entirely. Neither speech of a side-by-side pair reaches `document.xml` (see the
`dual-dialogue` golden snapshot). Existing behaviour, outside this change.

**Fixed along the way (on `main` too):** applying a duplicate of any system
format except Industry Standard crashed the app with a blank window (React
#185, maximum update depth). Those copies are stored without the title-page
rules, so `withMissingRules` built a new template object on every
`getActiveTemplate()`. Five components subscribe to that selector, and each
re-rendered forever. `resolveTemplate` now caches the filled template per stored
object (`stores/formattingTemplateStore.ts`), and
`stores/activeTemplateIdentity.test.ts` pins it. Found while testing
"Podcast (Copy)" in the browser. It also blocked "duplicate the format and
edit the copy", which is how a writer changes Podcast's numbering.

**Checked in Chrome (2026-10-16, static build on :8008):**
- Podcast applied from Format → Formatting Template, starter numbered FX 1 / 1 / MX 1 / 2.
- Wrapped lines stay aligned with the text.
- A line inserted mid-scene renumbers the lines below; an empty line gets no number until it has text.
- Show Element Numbers off and on: nothing else on the page moves.
- Scene numbers and element numbers share the gutter cleanly.
- Template editor Numbering section, with a live summary.
- Restart at Scene plus the 12.3 style gives 1.1, 1.2, 1.3, then 2.1 after SCENE 2, while FX keeps counting (FX 2).
- Switching to Radio Play removes every element number.
- Duplicated formats apply without a crash.

**Exports checked from the running app (2026-10-16):**
- **PDF:** numbers in the margin. Page 1 ends at line 8 with (MORE) and page 2
  opens with HOST (CONT'D) and line 9, exactly as in the editor. Revision
  asterisk in the right margin.
- **Print:** goes through that same PDF by default. With "print via PDF" off,
  the print stylesheet (simulated in Chrome) keeps the numbered dialogue
  `position: static`, and the asterisk stays in the right margin.
- **Word (opened in Word for Mac):** FX and MX numbers hang in the margin, and
  dialogue numbers sit before the text with wrapped lines aligned.
- **FDX:** well-formed, with `Number` on every numbered paragraph.

**Existing problem in Word, not caused by numbering:** a revised paragraph's
asterisk wraps onto a line of its own instead of sitting in the right margin.
It happens with numbering off too (`test-script/docx-revision-mark-numbering.test.ts`
writes both versions). Worth its own fix.

**Still to do by hand:** check that Final Draft displays `Number` on a Dialogue
paragraph. Final Draft isn't installed on the dev machine.

