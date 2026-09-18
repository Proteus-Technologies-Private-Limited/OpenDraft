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
      avPara | avShot | avDirection | avGraphic          (the AV types)
      | action | sceneHeading | character | dialogue     (screenplay elements)
      | parenthetical | transition | shot | general
      | lyrics | customElement
    avImage attrs: { src, alt, assetId, aspect }
```

The cell's content expression is built from `AV_CELL_ELEMENT_IDS` so the list
and the schema cannot drift. `avPara` leads it deliberately: a content
expression's default type is the first that can stand alone, and that is what
Enter at the end of a cell produces.

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

**Numbering runs through the document, not through one body.** A script may hold
several `avBlock`s — an intro paragraph, or a scene heading titling the section,
between two of them is ordinary — and they are sections of one piece. Celtx
numbers shots from 1 straight through a Multi-Column AV script, and a clock that
went back to `0:00` at every heading would be telling the writer something
untrue about their own edit. `computeRowTimings` takes an `AvTimingOffset` and
`nextTimingOffset` reads the continuation off the rows it just computed, so a
manual `start` override carries through correctly. `buildCueDecorations` threads
it down the document and `extractAvBodies` threads it through the exporters, so
the spreadsheet and the screen agree.

Each body still reports its **own** `totalSeconds`: a section total is the number
a producer reads off that section.

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

### Screenplay elements in a cell

A cell also holds ordinary screenplay elements. **The schema permits; the
template decides.**

`FormattingElementRule.avCell` is `'none' | 'video' | 'audio' | 'both'`, edited
per element in the Template Editor as *In AV columns*. It says which column
offers that element — not whether the document may contain it, which the schema
settles either way.

It has to be this way round for two reasons. A template can be switched on a
document that already exists: if the schema admitted only what the template of
the day allowed, changing template would make a document unparseable rather than
merely restyled. And the industry formats do mix them — Final Draft AV carried
separate styles for video description, character and dialogue inside the
columns, and WriterDuet's A/V template puts Action and Shot in the visual column
and Character, Dialogue and Parenthetical in the audio one. An on-camera
interview in a corporate or documentary script is ordinary dialogue, and there
was no way to write it.

The AV Script template follows that split:

| Column | Elements |
|---|---|
| Video | Action, Shot |
| Audio | Character, Dialogue, Parenthetical, Lyrics |
| Both | General |

Film Screenplay leaves every rule at `'none'`, so an AV body inside a screenplay
offers exactly the four AV types, as it did before the field existed.

Not every element can be placed. `AV_SCREENPLAY_CELL_ELEMENT_IDS` is the set the
cell will hold; act breaks, cast lists and the title page are document-level
furniture and are not offered a control. `customElement` is in the list, so a
template's own elements can be placed too — one node type carrying a
`customTypeId` covers all of them.

**Geometry does not come with them.** Every screenplay indent is absolute from
the page's left edge (Character sits at 3.7in) and a column is a couple of
inches wide, so the indent alone would leave no room for the text.
`generateRuleProperties` omits indents for the four AV types, and
`styles/avScript.css` strips them from `.av-cell .screenplay-element` with
`!important` — the template's CSS is injected at runtime and wins any tie on
document order. Typography survives; position does not apply inside a cell.

That same pass fixed a gap: the AV types have no `ELEMENT_CSS_CLASS` entry, so
`getSelector` fell through to the custom-element selector, which matches
nothing. Restyling *Video Shot* in the Template Editor had never done anything —
the static rules in `avScript.css` were the only thing drawing it.

Enter inside a cell honours the template's `nextOnEnter`, but only where the
cell would take the answer and the template offers it in **this** column, so
Character flows to Dialogue in the audio column and anything that does not
survive both tests falls back to `avPara`. A rule's `nextOnEnter` must name a
type that is valid *outside* a cell too — the same field drives Enter in the
ordinary body, where `avPara` is not a legal node.

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
spreadsheet and a PDF cannot disagree about what row 7 says. `AV_CELL_PARA_STYLE`
there is the matching single source for how a cell paragraph is *set* — upper,
bold, italic, small caps — covering the four AV types and every screenplay
element a cell can hold, so Word and the PDF cannot disagree either. It is
deliberately not read from the active template: an export has to be reproducible
from the document, and these are the conventions of the format rather than a
preference. Word has real small caps, so a super keeps them there; the monospace
PDF face does not, so it is uppercased instead.

The two lossy bridges carry element identity as far as they can:

- **Fountain** is a single column and cannot say "these two are side by side",
  so rows are flattened in order under a `[[Video]]` / `[[Audio]]` note. Within
  that, an element with a Fountain form gets it — a cue is a cue and dialogue is
  dialogue. The AV types, Action, Shot and a scene heading stay *forced* Action:
  an unforced all-caps line after a blank one is a character cue and would
  silently pull the next paragraph into dialogue, and a scene heading inside one
  cell of one row is not a scene in the script's outline.
- **FDX** emits each cell paragraph with its real Final Draft type, so a
  Character shows up as a Character rather than one more line of General. The
  four AV types have no FDX equivalent and stay General, which is the
  degradation this export has always made. `data-av-side`, `data-av-row-id` and
  `data-av-style` ride along for an FDX-aware reader.

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

`avCellElementRules(template, side, currentId)` resolves it, and the order is:

1. **The four AV types, always** — whatever the template says, including a type
   it explicitly disables. They are what an AV body is made of, and a list that
   omitted one would leave a paragraph the writer could neither convert nor
   convert back. Labels are borrowed from the template where it has them, so a
   writer who renamed *Video Shot* still sees their own wording.
2. **Whatever the template admits to this column**, in the template's own order.
3. **Whatever the caret is already on**, however it got there — a template
   switch, an import, a document written under different rules.

Step 1 is load-bearing. Building the list by filtering the template's rules is
what it used to do, and that left an empty dropdown — and a body with no way to
set an element — in two reachable states:

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

### Starting a body from the element menu

`avBlock` also carries a `FormattingElementRule`, so a template decides whether
the **element menu** offers *AV Columns (Two Column)* beside every other
element. That is where a writer goes to ask "what is this line?", and going to
the Format menu was the only route before. It is on in Film Screenplay and AV
Script, off in the other system formats, and `withMissingRules` backfills it —
switched **off** — into templates saved before it existed, because a writer's
own format is theirs to decide.

It is not a paragraph type. Picking it runs `insertAvRow`, and its typography
fields are never read: an AV body is a table, and the formatting lives on the
elements in its cells. `templateCss` skips it, the Template Editor shows a note
in place of the formatting pane, and it is kept out of the `nextOnEnter` /
`nextOnTab` menus.

Four routes reach it, all landing on the same command:

| Route | Where |
|---|---|
| Element menu | Enter on a blank line, or the element-menu shortcut (⌥↩ by default) |
| Toolbar | the element dropdown |
| Menu | **Format ▸ Element ▸ AV Columns (Two Column)** |
| Menu | **Format ▸ AV Script ▸ Insert AV Columns**, or ⌘⇧A |

`scriptBodyElementRules` builds the list for the first three. It drops the four
AV paragraph types, which exist only inside a cell — `setNode('avShot')` on a
line of Action asks the schema for a node the document cannot hold there. The
AV template marks them enabled, because that is how their formatting is edited,
so a list filtering on `enabled` alone offered them everywhere: the toolbar had
its own filter and **Format ▸ Element** did not. One shared function now, so the
two cannot drift again.

### Where a new body lands

`wrapNewAvBlock` used to be `tr.replaceSelectionWith(block)`, which put the body
at the **cursor** — so starting one from the middle of `INT. KITCHEN - DAY` split
the heading and left a stray `INT. ` scene heading above the table, which then
turned up in the navigator and in the scene numbering. A scene heading above an
AV body is exactly right, and is how the format is headed; it just has to
survive whole.

The rule now, resolved at the shallowest ancestor whose parent will take an
`avBlock`:

| The caret's line | What happens |
|---|---|
| has text | body goes **after** it, line untouched |
| is blank | body takes its place |
| is blank, body directly above | that body gains a row |
| is blank, body directly below | that body gains a row, at the top |
| is blank, body above **and** below | the two merge, the new row is the seam |
| a line of text between two bodies | stays its own line |

The adjacency cases are not tidiness. Two `avBlock`s with nothing between them
draw as one continuous table and are not one: they carry separate column widths,
repeat the header row, and would restart the numbering. A merge keeps the first
body's column settings — it is the one already on screen above the caret.

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
        audio:
          - style: character
            text: MARIA
          - style: dialogue
            text: We build them by hand.
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
- **Style names are stable and readable.** `body`, `shot`, `direction` and
  `onscreen` are the four AV types and may never be renamed: files written
  before the rest existed use them, and reusing one would silently restyle every
  AV file ever saved. That is why the screenplay element `shot` — a camera
  instruction — writes as `camera-shot`: `shot` has meant the video column's
  shot line since the format was written. An unknown style reads back as `body`,
  which is right for a hand-written file. `customElement` has no style name: its
  identity is an attribute, and it writes and reads as `body`.
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
