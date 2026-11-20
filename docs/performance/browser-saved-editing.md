# Saved browser editing: release, main and pagination reuse

Related: [#229](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/issues/229).
The reporter's latest comment says desktop typing, held Backspace and scrolling
are smooth on PikaOS, while browser typing/Backspace remain slow. Their browser
version is not known. This investigation measures a synthetic browser workload;
it does **not** establish that their remaining issue is resolved.

## Setup and controls

- Latest release **v2.14.2**, source tag `d30f9854`, versus main `7714d63e`.
  These are source builds, not downloaded desktop binaries or the hosted site.
- Both use Vite production builds with `--minify false`, Node 20, the same
  dependencies, headless system Chromium and a 1440×900 viewport. No dev/HMR.
  The standard minified candidate also passed a saved-editing smoke test
  ([result](browser-saved-editing/minified-smoke.json)): 150 pages, +120/-120
  changes, five HTTP 200 saves, three recovery writes and verified backend body.
- Linux x86_64 KVM cloud VM, three exposed AMD EPYC 9V74 vCPUs. This is not the
  reporter's machine, browser/GPU stack, or WebKitGTK.
- Saved projects through the real authenticated FastAPI backend and filesystem
  storage; isolated synthetic user/database. No mocked save responses.
- Short control: **217 blocks / 11 measured pages**. Long: **3,110 blocks /
  150 measured pages / 115 scenes**. Both use the shared synthetic screenplay
  fixture. Page count comes from the editor's pagination state.
- Page view, Navigator on, English `en_US` spellcheck on (304 marks in the long
  fixture), grammar off. Separate runs change Page/Speed, Navigator or spellcheck.
- Autosave is **5 seconds**, the supported minimum, to exercise persistence during
  the run; the normal default is 30. Recovery writes and successful saves must
  actually occur, and a backend GET must match the restored document.
- 120 characters inserted into dialogue near the middle; then 120 Backspace
  keydowns, 119 with `repeat=true`. Requested intervals 50/33 ms. Serial automation
  adds overhead; this is not a hardware key-repeat-rate measurement.
- Every phase asserts the exact document-size delta (+120/-120), key count,
  final document equality and caret restoration. Common English words must not
  be misclassified because of a missing dictionary.

Latency below means **keydown → rAF + timeout**, an event-loop/render-opportunity
proxy, not input-to-photon. Main-thread counters include the 1.5-second tail after
each phase. CPU-sampled runs are separate from primary timing runs. No builds or
tests ran concurrently with those measurements.

## Release versus main

Two unprofiled rounds, reversing revision order in the second round. Ranges are
per-run medians, milliseconds:

| Revision | Pages | Typing | Backspace |
| --- | ---: | ---: | ---: |
| v2.14.2 | 11 | 7.1–7.4 | 7.2–7.4 |
| main | 11 | 7.3–7.4 | 7.1–7.5 |
| v2.14.2 | 150 | 27.7–31.1 | 27.6–29.0 |
| main | 150 | 29.4–29.4 | 28.3–30.4 |

The long script costs substantially more per key. These runs do not identify a
new release-to-main regression.

Single-run **diagnostic ablations** on main, 150 pages (not statistical estimates):

| Settings | Typing median | Backspace median |
| --- | ---: | ---: |
| Page, Navigator off, spellcheck on | 24.8 | 23.6 |
| Page, Navigator on, spellcheck off | 22.7 | 23.5 |
| Speed, Navigator on, spellcheck on | 28.8 | 27.7 |

Navigator/spellcheck contribute work; Speed alone does not remove the long-script
cost here. They remain useful follow-up profiling targets, rather than reasons
to disable features for users.

## Measured cause and focused change

The main CPU trace shows repeated whole-document decoration work. Pagination
rebuilds its `DecorationSet` on document edits even when page geometry is identical:
text changes shift later document offsets, which also requests an extra caret
visibility check. In the final sampled main run, pagination `buildDecorations`
accounts for **487.1 ms inclusive**. `computeBreaks` is another 487.1 ms inclusive;
these are different call paths, not a claim that all editor cost belongs here.
Other substantial costs include native selection/layout and other decoration
providers. Saves and recovery capture execute, but do not dominate the trace.

The change retains full page-break computation. For one plain text replacement
inside a top-level text block, it maps the cached pagination decorations through
the transaction **only if the new page geometry and labels still match**. It also
avoids the extra post-pagination caret check in that case. A new layout,
structural/multi-step edits, changed breaks, internal paragraph/dual grids,
printing notes and explicit repagination keep the full rebuild path.

In the separate candidate CPU trace, pagination `buildDecorations` accounts for
**13.2 ms inclusive**. The regression test asserts that this ordinary edit path
never calls `DecorationSet.create` (the test fails on unchanged main), while
comparing positions/attributes and
pagination state to a fresh build. Wrapping, split, forced-repagination,
printing-note and oversized-widget cases verify fallback behavior.

Three unprofiled long-script comparison rounds were run in order
candidate/main, main/candidate, main/candidate. Values below are **medians across
three per-run statistics**, not pooled event quantiles:

| Phase | Build | Event proxy median / p95 (ms) | Scripting (ms) | Main-thread task (ms) |
| --- | --- | ---: | ---: | ---: |
| Typing | main | 28.5 / 46.1 | 2,094 | 4,534 |
| Typing | candidate | 27.2 / 43.6 | 1,920 | 4,237 |
| Backspace | main | 26.9 / 44.2 | 1,821 | 3,897 |
| Backspace | candidate | 28.6 / 42.6 | 1,843 | 4,092 |

The targeted rebuild cost is removed and typing scripting is lower in this
sample. **Backspace latency/task time do not show a reliable overall improvement**;
the third candidate round was noisier and is included. No broad latency or
percentage-speedup claim follows from these VM samples. Short-script control
medians remain about 7 ms (candidate 7.1/7.3, main 7.4/7.5 typing/Backspace).

## Evidence and reproduction

[Runner instructions](../../test-script/browser-editing/README.md) describe the
isolated backend, revision builds, settings, persistence assertions and CPU capture.
[Selected raw measurements](browser-saved-editing/measurements.json) contain all
21 valid runs used here: eight release/main baselines, three ablations, six
unprofiled candidate/control runs and four short/profile controls. Each preserves
its original descriptive revision label and an explicit build identity. Earlier
runs predate automatic bundle hashing; those hashes were taken afterward from
preserved preview output. Full source revisions, entry hashes, candidate source
and patch hashes are recorded in that file. No application code changed between
the candidate build and these runs.

Compressed CPU traces (decompress before loading in DevTools):

- [main](browser-saved-editing/main.cpuprofile.gz) and
  [candidate](browser-saved-editing/candidate.cpuprofile.gz).
- [main summary](browser-saved-editing/main-cpu-summary.json) and
  [candidate summary](browser-saved-editing/candidate-cpu-summary.json).

The summary script also accepts `.gz`. Inclusive times overlap and must not be
summed. Traces contain only the synthetic workload. Pilot runs with a blocking
scene-spacing prompt, an invalid English language code, or failed fixture
assertions were excluded, rather than treated as valid performance results.

This is a bounded pagination optimization and a reproducible investigation.
Retesting the same document in the reporter's actual browser remains necessary
before treating #229 as resolved.
