# AV Editor — columns, cue timing, storyboards and interchange

Implements issues **#118** (expanded AV format) and **#119** (AV import/export).

## Why this shape

#118 proposed fully user-configurable columns. What shipped follows the industry
instead, after checking what comparable tools actually do:

| Tool | Two-column AV | Cue / timing | Storyboard column | Configurable columns |
|---|---|---|---|---|
| **Celtx** (Multi-Column AV) | yes | shot number + timestamp + auto-summed duration | yes, image upload per shot | **no** — fixed typed columns + a Shot Details drawer |
| **WriterDuet** | yes (A/V template, MultiColumn is Premium) | no | `Image` line type | two columns, adjustable widths |
| **Final Draft 13** | **no** (the separate *Final Draft AV* product is discontinued) | — | — | — |
| **Fade In** | **no** | — | — | — |
| **StudioBinder** | script and shot list are separate linked objects | per-shot | generated from the shot list | n/a |

Celtx — the leader in this exact niche — converged on **fixed, typed columns**
rather than arbitrary ones. That is what OpenDraft does: Cue/Timing · Video ·
Audio · Storyboard, with adjustable widths (the WriterDuet idea).

For interchange there is **no structured AV/shot-list standard**. FDX, Fountain
and OSF are built around screenplay elements and cannot represent arbitrary
row-and-column AV data. What production tooling exchanges is **spreadsheets** —
Movie Magic Scheduling and StudioBinder both import CSV, shot-list tools export
xlsx — so XLSX and CSV carry the AV document to other tools.

The `opendraft-av` YAML format from #119 is also implemented, for the job a
spreadsheet cannot do: a readable, diffable, version-controllable text file that
still preserves paragraph styles, cue metadata and layout. It is a format only
OpenDraft reads, so it complements the spreadsheet rather than replacing it —
see [OpenDraft AV YAML](#opendraft-av-yaml) below.

## Data model

```
avBlock   attrs: { columns: {cue, image, widths}, headers, repeatHeaders }
  avRow   attrs: { shot, start, duration }      content: avCell avCell avImage?
    avCell  attrs: { side: 'video' | 'audio' }
      avPara | avShot | avDirection | avGraphic
    avImage attrs: { src, alt, assetId, aspect }
```

**Backward compatibility is load-bearing.** Every AV document written before
this is a row of exactly two cells with no attributes. `avImage?` is optional
and every attribute defaults to `null`, so those documents parse and edit
untouched with no migration pass. Readers never touch the raw attrs — they go
through `readColumnConfig()`, which repairs a partial or malformed config.

### Cue timing (`editor/avTiming.ts`)

Shot numbers and start timestamps are **derived, never stored**:

- the shot number is the row's position (`1.`, `2.`, …)
- the start time is the running sum of the durations above it
- the total runtime is the sum of all durations

So inserting a row mid-document renumbers and re-times everything below it with
no migration. Both can be overridden per row (`shot: '22c'`, or a manual `start`
that pins the clock from that row onward).

`parseTimecode` accepts `5`, `0:05`, `1:30` and `1:02:03`, and returns `null`
for anything else — a half-typed cell is not an error, so it is left alone
rather than coerced to zero. `1:75` is rejected rather than read as `2:15`,
because that is a typo and carrying it would hide the mistake.

### The four AV text styles

| Style | Renders as | For |
|---|---|---|
| `avPara` | body text | narration, dialogue, sound |
| `avShot` | bold, uppercase | camera instruction |
| `avDirection` | italic | performance / staging note |
| `avGraphic` | small caps, ruled left edge | on-screen text — supers, lower thirds, captions |

`avGraphic` is the fourth style #118 asked for. A monospace PDF face cannot do
small caps, so supers are uppercased there instead; DOCX uses real `smallCaps`.

## Export

| Format | Module | Notes |
|---|---|---|
| YAML | `avYaml.ts` | Structured, human-readable, versioned. Keeps what a spreadsheet flattens: per-paragraph styles, cue metadata, column names and widths, document settings. |
| XLSX | `avSpreadsheet.ts` | Hand-built on the existing `jszip` — no new dependency. Frozen header row, wrapped cells, sized columns, one sheet per AV body. |
| CSV | `avSpreadsheet.ts` | RFC 4180. Multiple bodies separated by a blank line rather than merged. |
| Plain text | `avSpreadsheet.ts` | A labelled block per shot. Deliberately *not* column art, which breaks the moment a line is longer than the guess. |
| PDF | `avPdfTable.ts` | Own draw pass: column geometry, header repeated per page, page breaks **between** rows. |
| DOCX | `avDocxTable.ts` | A real Word table with `tableHeader` (repeating headers) and `cantSplit` (rows kept whole). Word owns the pagination. |

`avDocument.ts` extracts one shared grid that every writer consumes, so a
spreadsheet and a PDF cannot disagree about what row 7 says.

### Row-level pagination

A shot whose video and audio land on different pages is unreadable on set, so a
row that will not fit moves whole to the next page. The one exception is a row
taller than a whole page — it has nowhere to move, so it draws where it stands
rather than looping forever.

## Import

`avImport.ts` reads XLSX (both inline strings and the shared-strings table that
Excel itself writes) and CSV, then guesses what each column is.

The mapping is **fuzzy on purpose**: a sheet from another production will not
use OpenDraft's header names. `Visual`, `Picture`, `Vision` → video; `Sound`,
`Narration`, `VO` → audio; `Length`, `Run Time`, `Secs` → duration. A column
matching nothing is dropped rather than guessed at. A two-column sheet with
unrecognisable headers falls back to video/audio, which is the classic AV shape.

Durations are normalised on the way in, so `10` from someone else's sheet
becomes `0:10`. A purely sequential shot number (`1.`, `2.`) is **not** stored,
so the row still renumbers when one is inserted above it.

## UI

- **Format ▸ AV Script ▸ Insert AV Columns** — turn the line at the cursor into
  an AV table, in *any* script, not only one started from the AV template
  (⌘⇧A). Reads **Remove AV Columns** when the cursor is already inside one.
- **Format ▸ AV Script ▸ Row** — insert above/below, delete
- **Format ▸ AV Script ▸ Columns** — toggle Cue and Storyboard, repeat headers, column widths
- **Format ▸ AV Script ▸ Storyboard** — add/replace/remove frame, aspect ratio
- **File ▸ Export** — AV YAML (.yaml), AV Spreadsheet (.xlsx / .csv), AV Plain Text
- **File ▸ Import** — AV Document (.yaml / .xlsx / .csv)
- **Page Setup** — Portrait / Landscape, with landscape-appropriate margins

### Switching a column off

A column is on or off for the whole body, as one flag on the avBlock. Nothing is
deleted when it goes off — durations stay on their rows, storyboard frames stay
in theirs — so turning it back on restores exactly what was there. But the same
flag decides what `readAvBlock` writes, so the column also leaves the printed
page, the PDF and the spreadsheet. `avColumnDataCount` counts the rows that
would go quiet (a typed duration or a *manual* shot/start override; a frame with
a picture in it, not an empty slot) and the menu asks before hiding any.

**What is drawn is decided by CSS, from the block's own `data-cue` /
`data-image`, never by a child node view reading its parent's attributes.**
`renderHTML` writes those flags and the track list (`--av-grid`) onto the same
element in the same pass, so the two cannot disagree. Anything still drawn in a
grid with no track for it takes the next column's track and shunts every column
after it along one — the whole row out of alignment, which is what switching a
column off looked like. For the storyboard column that needed no timing subtlety
at all: `toggleAvColumn` flips the flag and nothing else, so every row that
already had a frame kept it as a grid item with nowhere to sit.

### Resizing a column

Drag the divider between any two columns; double-click it to put that pair back
to the built-in widths. `Format ▸ AV Script ▸ Columns ▸ Column Width` does the
same in steps, and remains the keyboard and touch route — the dividers are
`aria-hidden` and out of the tab order, because a hundred-row body would
otherwise put three hundred tab stops through the document.

Three things are worth knowing about how it works.

**Widths are relative, the pointer is not.** A width is stored in grid `fr`
units so the same body lays out on screen, on Letter and on A4. `avColumnDrag`
converts: the visible tracks share the row's width, so their total `fr` over
their total px is the exchange rate, read back from the row's *computed*
`grid-template-columns` (the used pixel values — the cue track may be sitting on
its 64px floor rather than the 0.5fr it asks for).

**The two columns either side of a divider trade width, and both stop when
either one hits a limit.** Letting them clamp independently makes the divider
slide on while only one side responds, which reads as the handle coming loose
from the line. That is also why the drag uses its own saturating clamp instead
of `clampColumnWidth`: that one answers `1` for anything at or below zero, which
is the right reading of a malformed stored attribute and quite wrong mid-drag,
where a column being squeezed to nothing would snap to a middling width.

**The listeners are native, and attached to the handle itself — not React's.**
ProseMirror binds `mousedown` on `view.dom`; React 19 delegates to the root
container, which is an *ancestor* of it. So a synthetic `onPointerDown` runs
strictly after ProseMirror's handler, by which point `MouseDown` has moved the
selection to the divider and registered its own document-level mousemove/mouseup
to drag a text selection against ours — and `stopPropagation` from React cannot
prevent any of it. From a listener on the handle, below `view.dom` in the tree,
it can. The move and release listeners then go on `window` rather than relying
on `setPointerCapture`, so the drag survives the pointer leaving the 16px strip,
which it does on the first frame. This was the bug in the first version: it was
not that the arithmetic was wrong, it was that the gesture never reached it.

**Nothing inside the editor is touched while a drag is live, and this is the
part that bites.** The first version previewed by writing `--av-grid` onto the
`.av-block` element. ProseMirror's DOMObserver watches attributes across
`view.dom`; `registerMutation` lets a `style` change through unless there was no
old value — the block always has one, from `renderHTML` — and `avBlock`, having
no custom node view, falls back to a `ignoreMutation` that returns false
whenever a `contentDOM` exists. So every frame of the drag was read as a user
edit to the document: the style was reverted on the spot (the columns never
appeared to move) and the block was re-rendered, which remounted the row node
views underneath the gesture. What the writer saw was a resize that did nothing,
then an editor that had stopped responding to clicks — because the drag state
died with the remounted node view, the release handler found nothing, and its
teardown never ran.

So: a guide line, parented to `document.body`, outside `view.dom` entirely.
Word, Google Docs and prosemirror-tables all draw the same thing for the same
reason. The guide follows the COLUMNS rather than the pointer, so it stops when
one hits its limit instead of drifting away from the layout it claims to be
setting. The widths change once, on release.

**The session is module state (`avColumnResize.ts`), not a `useRef` in the node
view.** A node view can be remounted mid-drag, and state that dies with it
strands the window listeners and the `av-col-resizing` class. That class carried
`cursor: col-resize !important` and `user-select: none !important` across the
whole app, so leaking it looked like the editor had died rather than like
anything to do with column widths. It is now owned by a session that cannot be
unmounted, released on pointerup, pointercancel, Escape and window blur, and
scoped to `.ProseMirror` so that even a leak could not take the app with it.
`avColumnResize.test.ts` holds that invariant down.

The divider is drawn at rest, faintly. Showing it only on hover was the other
half of "resize is not working": a control nobody can see is a control nobody
finds. It brightens under the pointer, and a class on `<body>` keeps it lit and
holds the `col-resize` cursor for the duration of a drag, since `:hover` and
`:active` both stop applying the moment the pointer leaves the strip.

The handles are absolutely positioned, which is load-bearing rather than
cosmetic: an in-flow grid item with an explicit `grid-column` is placed before
the auto-placed cells, and auto-placement then *skips* the track it occupies —
so an in-flow handle on track 1 would push Video into Audio's column. Out of
flow it takes no part in placement and `grid-column` still names the area its
offsets resolve against. Which line each one sits on, and which exist at all, is
decided in CSS from the block's `data-cue` / `data-image`, for the same reason
the cue gutter is.

### The element list inside a cell

`avCell`'s content is `(avPara | avShot | avDirection | avGraphic)+` in the
schema of **every** document. A template decides how those four look, not
whether they exist — so the toolbar's element list inside a cell is built from
the schema (`avCellElementRules`) and borrows the active template's labels where
it has them, rather than being filtered out of the template's rules.

Filtering the rules is what it used to do, and that left an empty dropdown — and
a body with no way to set an element — in two reachable states:

- an AV body inside a screenplay, which **Insert AV Columns** now allows in any
  script, where Industry Standard has no `avPara` rule to find;
- an AV script whose template did not come back with it: a restored session, an
  import, a `.odraft` from a backup. The AV nodes are intact; only the
  formatting preference is missing, and that is no reason to make the document
  uneditable.

The restore path has a second half. `setContent` raises `selectionUpdate` only
when the mapped selection differs from the old one, so swapping in a whole new
document can leave `activeElement` naming the element the *previous* document's
caret was on. `resolveActiveElement` is called explicitly after a recovery
restore for that reason, and `Toolbar`'s `isInsideAvCell` is keyed on the editor
STATE rather than on `activeElement`, so it cannot hold an answer computed
against a document that no longer exists.

Every AV control is reachable from a menu, not only a keyboard shortcut. That is
the lesson of issue #116: an iPhone or iPad has no Tab and no Mod-Enter, so a
shortcut-only route is no route at all.

`toggleAvBlock` was the last thing still missing from that list. It had only
⌘⇧A, so in a script that did not already contain an AV table there was no way
to make one — and since every other AV item is gated on the cursor being inside
an AV cell, the whole group sat permanently greyed out with nothing that could
ungrey it. It is now the first item in the group, and never disabled.

The four entries live under one **AV Script** parent rather than three siblings
in Format: the menu ran off the bottom of the window otherwise. That needed the
menu renderer to recurse (`renderMenuNode` in `MenuBar.tsx`) — it drew exactly
two levels before, so **Column Width** and **Frame Aspect Ratio**, already three
deep, were rendering as rows with no arrow and no action.

The duration field is an `<input>` in a node view (`AvRowView.tsx`) rather than a
ProseMirror cell, for the same reason — it is structured data an exporter wants
as a number, and it has to be tappable.

## Verification

Unit tests cover timing, the column model and backward compatibility, the
spreadsheet writers, the PDF table geometry and pagination, and import with
round-trips. Generated files were additionally opened with third-party readers:

```bash
./venv/bin/pip install openpyxl python-docx pypdf
# then generate into test-script/output/ and open with those libraries
```

- **XLSX** — opens in `openpyxl` with warnings escalated to errors
- **DOCX** — `python-docx` confirms `w:tblHeader` and `w:cantSplit` are present
- **PDF** — `pypdf` confirms the header repeats on every page and rows do not split

## OpenDraft AV YAML

Each of the other formats gives something up. A spreadsheet flattens cells to
plain strings, losing paragraph styles and the document's settings. `.odraft`
keeps everything but is opaque. YAML sits between them: plain text you can read,
diff and hand-edit, that still preserves structure.

```yaml
format: opendraft-av
schemaVersion: 1
document:
  title: Summer Campaign
  draft: Draft 3
av:
  - columns:
      - id: cue
        name: Shot / Time
        width: 0.5
      - id: video
        name: Video
        width: 2
    repeatColumnHeaders: true
    totalRuntime: '1:35'
    rows:
      - cue:
          duration: '0:05'
        at: '0:00'
        video:
          - style: shot
            text: WIDE ON A BUSY CITY STREET
          - style: onscreen
            text: 'SUPER: Summer 2026'
        storyboard:
          description: City wide
          aspect: '16:9'
          asset: a1
```

Design decisions worth knowing:

- **Images are named, never embedded.** Base64 blobs would make the file neither
  readable nor small. Descriptions, aspect ratios and asset ids survive, so the
  column and every slot round-trip — only the pixels need re-attaching.
- **Derived values are not stored.** Only cue fields the writer actually set are
  written. Shot numbers and start times recompute from row order, so writing
  them back would freeze values that are meant to move. `at:` is emitted for a
  human reading the file and ignored on import.
- **Widths travel with their column**, so a hand-edited file cannot get a
  separate width map out of step with the columns.
- **Every file identifies itself and carries a schema version.** A file from a
  newer OpenDraft is refused by name (`version 99 … reads up to 1`) rather than
  read as a structure we do not understand.
- **Unquoted colons are recovered.** YAML reads `- NARRATOR: Hello` as the map
  `{NARRATOR: "Hello"}`, and nearly every AV audio line has a colon in it. The
  original text is recoverable exactly, so it is reconstructed rather than
  silently dropped — which would lose most of a hand-edited file.

Uses `js-yaml`, promoted from a transitive dependency to a direct one so a
tooling bump cannot remove it.

## Not implemented

- **An import column-mapping dialog** — the guess is applied and reported in a
  toast. `gridToAvBlock` already accepts an explicit `roles` override, so the UI
  is a thin layer on top when it is wanted.
