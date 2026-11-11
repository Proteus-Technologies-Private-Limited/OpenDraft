# Local script health (#243)

Open **Tools → Analytics → Script Health** for an on-device report of concrete
issues to review before sharing a script. It is available without an account,
network connection, API key or paid service. It reads the open editor and its
script notes; it never changes text or numbering and sends no script content
to a model or service.

The first version covers:

- No printable body text, excluding title-page fields and Fountain notes/sections.
- Empty scene headings.
- Repeated scene numbers and repeated displayed element references. Element
  references are compared within the active format's counter/reset scopes,
  including shared `countWith` counters. Sparse imported references without a
  counter definition are compared conservatively per element type and scene.
- Empty character cues, character cues without nonempty dialogue, and
  dialogue/parentheticals without a preceding cue in their speech block. Each dual-dialogue column has its own
  flow. Lyrics may follow a cue. AV cells are excluded, and these checks only
  run when the active format enables Character/Dialogue and sends Enter from
  Character to Dialogue. The dialog and the Reports/PDF summary explain when
  dialogue checks are skipped, including when a custom format sends Character
  → Enter to Parenthetical instead.
  Nonprinting annotations and custom elements with `customTypeId: stageDirection`
  do not interrupt speech in any format. A direction such as “[Enter OPHELIA.]”
  does not change the speaker: later dialogue remains attributed to HAMLET until
  a new cue or speech boundary. This structural check does not interpret entrances
  or infer a speaker from stage-direction text.
- All unresolved script notes, including empty roots with replies. Resolved
  notes are excluded. General notes and Fountain notes are not threaded script notes and are not treated as open
  review tasks by this report. Note anchors are shared with Open Notes and include
  Sections, Fountain notes, title-page content and nested blocks.

**Go to finding** closes the report and selects the current text location.
An unresolved note whose mark is missing offers **Open notes**, filtered to that
specific note. The report updates while open when the document, format,
numbering visibility or script notes change. Navigation checks document
identity before using a position, so a result from an older document cannot
silently jump to different text.

The dialog previews up to 300 findings and explains that excerpts are shortened
to 180 user-perceived characters (Unicode grapheme clusters), preserving emoji,
vowel signs and conjuncts at the cutoff. Its CSV export includes every finding, with separate scene
number, scene heading, explanation and excerpt columns. Exports use the
production scene number with an ordinal fallback, matching the other reports.
An empty script title falls back to `Untitled` in the filename.

Script Health also appears in **Tools → Analytics → Reports**, using the same
pure `scriptHealthReport(findings)` table projection. The report summary holds
the scope, count and excerpt limit, above the table in previews and PDF. CSV
contains only column headers and actual findings, so sorting/filtering does not
include a fake summary row. Both dialogs use the existing CSV exporter with
UTF-8, quotation and spreadsheet-formula protection; the Reports dialog also
provides PDF export. The navigation dialog keeps export success/failure and
stale-document feedback inside its modal live region. Feedback belongs to the
findings snapshot and disappears as soon as findings refresh, including a
collaborator edit racing a jump or an export completing after a refresh. Cancellation does not
report success. Jump buttons describe their finding, context and excerpt;
findings without a navigation target do not show a disabled jump button.

This is the local script-health portion of issue #243, not full narrative
coverage. A clean report means these particular checks found nothing. It does
not evaluate plot, originality, character arcs or commercial prospects, assign
a story-quality grade, or establish compliance with a producer's submission
requirements. Empty headings and unfinished dialogue can be intentional in a
draft; findings are prompts for review, not automatic corrections. Existing
editor housekeeping may already repair some references before analysis runs.

## Validation

`frontend/src/utils/scriptHealth.test.ts` checks speech boundaries, lyrics,
dual dialogue, AV exclusions, title/nonprinting content, counter resets/shared
counters, stored automatic references, sparse imports, note marks, immutable
document updates and read-only behavior. Shared-anchor tests compare JSON and
ProseMirror documents, including nonprinting and nested blocks. Report tests
cover built-in registration, skipped-dialogue scope in summaries, scene columns, summary metadata, formula protection
and full exports beyond the preview limit.

With Vite running and Python Playwright installed:

```sh
OPENDRAFT_TEST_URL=http://127.0.0.1:5173/ python test-script/script_health.py
```

The browser regression exercises the real menu and dialog, CSV bytes, live
note updates, navigation after a document edit, unanchored-note navigation,
Escape, phone-width/Arabic layouts, offline CSV export, built-in Reports and PDF
downloads, nonprinting-note jumps, blank-note replies, accessible jump descriptions,
modal feedback and the Untitled filename fallback. Set
`OPENDRAFT_HEALTH_SCREENSHOTS` to capture synthetic desktop/phone evidence.
