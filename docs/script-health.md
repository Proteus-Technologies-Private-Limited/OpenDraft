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
- Character cues without nonempty dialogue, and dialogue/parentheticals without
  a preceding cue in their speech block. Each dual-dialogue column has its own
  flow. Lyrics may follow a cue. AV cells are excluded, and these checks only
  run when the active format enables Character/Dialogue and sends Enter from
  Character to Dialogue. Nonprinting annotations do not interrupt speech.
- Unresolved, nonempty script notes. Resolved notes are excluded. General notes
  and Fountain notes are not threaded script notes and are not treated as open
  review tasks by this report.

**Go to finding** closes the report and selects the current text location.
An unresolved note whose mark is missing offers **Open notes**, filtered to that
specific note. The report updates while open when the document, format,
numbering visibility or script notes change. Navigation checks document
identity before using a position, so a result from an older document cannot
silently jump to different text.

The dialog previews up to 300 findings. **Export CSV…** exports every finding,
with the scene, explanation and excerpt. The first data row describes the
scope of the report and its finding count. CSV uses the existing UTF-8 report
exporter, including quotation and spreadsheet-formula protection. Export
cancellation or failure does not report success.

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
document updates and read-only behavior.

With Vite running and Python Playwright installed:

```sh
OPENDRAFT_TEST_URL=http://127.0.0.1:5173/ python test-script/script_health.py
```

The browser regression exercises the real menu and dialog, CSV bytes, live
note updates, navigation after a document edit, unanchored-note navigation,
Escape, phone-width/Arabic layouts and offline CSV export. Set
`OPENDRAFT_HEALTH_SCREENSHOTS` to capture synthetic desktop/phone evidence.
