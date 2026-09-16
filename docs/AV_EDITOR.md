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

- **Format ▸ AV Row** — insert above/below, delete
- **Format ▸ AV Columns** — toggle Cue and Storyboard, repeat headers, column widths
- **Format ▸ AV Storyboard** — add/replace/remove frame, aspect ratio
- **File ▸ Export** — AV YAML (.yaml), AV Spreadsheet (.xlsx / .csv), AV Plain Text
- **File ▸ Import** — AV Document (.yaml / .xlsx / .csv)
- **Page Setup** — Portrait / Landscape, with landscape-appropriate margins

Every AV control is reachable from a menu, not only a keyboard shortcut. That is
the lesson of issue #116: an iPhone or iPad has no Tab and no Mod-Enter, so a
shortcut-only route is no route at all.

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
