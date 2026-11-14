# Issue #229: typing measurements after the merged performance work

Measured on 13 November 2026. This investigates the remaining report; it does
not close #229 or claim a fix for Fedora/Wayland/WebKitGTK.

## Builds and method

- Release tag `v2.12.0`: `941a88902114ad667f4781804b2d4f298e90940c`.
- Current main: `84ffb16f9ea199535b2cb106cc18a49d15e53902`, which contains #249.
  The release tag does not contain #249 (checked by commit ancestry).
- Both are production Vite builds with `--minify false`, served through preview.
  The same corrected benchmark drives both. No application performance change
  is introduced by this PR.
- Linux x86_64 VM, AMD EPYC 9V74, three visible CPUs, Chromium 154.0.8037.57,
  viewport 1440×900, Navigator explicitly open. No concurrent tests/builds.
- Two runs per build/size. The first round runs release then main; the second
  reverses that order. Each run uses a fresh browser context and synthetic text.
- Each phase types 40 characters at a requested 60 ms spacing or sends 40
  Backspaces at 33 ms spacing. Playwright round trips add overhead to that pace.
  The harness verifies 40 key events and document-size deltas of +40 and −40.
  Both builds finish every run without a browser error.
- Latency is keydown to a callback after the next animation frame, using the
  existing harness method. It is not a native input-to-paint measurement.
  Main-thread totals include the 1.5-second trailing observation window.
  Comparison runs have CPU sampling off; a separate main run records a profile.

The old `pagesGuess` selector reported zero. The corrected harness counts the
rendered page separators: size parameters 16 and 182 produce **15 and 150 pages**
on both builds. Passing 150 as the old argument produces only 124 rendered
pages here; the parameter must not be presented as a measured page count.

## Results

Values below are the range of the **two per-run statistics**, in milliseconds,
not pooled percentiles. Raw phase timings and counters are in
[the evidence JSON](issue-229-typing-2026-11-13.json).

| Build | Rendered pages | Typing median | Typing p90 | Backspace median | Backspace p90 |
| --- | ---: | ---: | ---: | ---: | ---: |
| v2.12.0 | 15 | 9.3–9.8 | 13.1–14.2 | 14.9–15.0 | 20.0–23.7 |
| main | 15 | 7.4–8.6 | 12.9–15.3 | 11.7–13.2 | 17.9–20.1 |
| v2.12.0 | 150 | 45.2–49.6 | 69.9–79.0 | 47.6–48.5 | 55.7–58.1 |
| main | 150 | 28.9–30.0 | 41.7–43.8 | 28.7–30.6 | 35.0–37.5 |

On the 150-page workload, the average of the two run medians drops from
47.40 to 29.45 ms for typing and from 48.05 to 29.65 ms for Backspace: about 38%.
This is evidence that the already-merged work improves this Chromium workload,
not a statistically established speedup across devices. Main also contains changes beyond #249, so this comparison does not isolate
any individual commit. The 150-page document still costs more than the
15-page one.

## What the current-main profile shows

The largest named JavaScript leaf sample is ProseMirror's `nodesBetween`
(about 159 ms across both editing phases). Other sampled work includes
pagination's document callback, decoration propagation (`forChild` and
`takeSpansForNode`), overlay measurement and recovery storage. Native/program
and idle samples are separate; these function totals are not the whole
main-thread cost or a proof of the native reporter's bottleneck.

The JSON includes the separate profiled run and top leaf samples. Full
`.cpuprofile` files and viewport screenshots can be generated with the harness;
they are not added to the repository. No further runtime cache/debounce change
is justified by this trace alone.

## Reproduce and follow up

With Node Playwright and Chromium available, build each revision in a separate
checkout, give the outputs different directories/preview ports, and run:

```sh
# In each checkout's frontend directory:
npx vite build --minify false --outDir /tmp/od-main-dist
npx vite preview --host 127.0.0.1 --port 4173 --outDir /tmp/od-main-dist

# From the checkout containing this PR's benchmark:
OPENDRAFT_CHROMIUM=/usr/bin/chromium OPENDRAFT_BENCH_REVISION=<served-commit> \
  node test-script/typing-lag.mjs http://127.0.0.1:4173/ 182 /tmp/typing-main --no-profile
# Omit --no-profile for a separate CPU trace; use size 16 for the short script.
```

Use the served build's commit for `OPENDRAFT_BENCH_REVISION`, not the harness
checkout's commit. Keep browser/fonts/viewport/preferences identical and check
`where.renderedPages` before comparing. Repeat the pair in reverse order.

#229 should stay open until a native Linux build containing #249 is retested.
Record the exact source revision for an unreleased build, since its version
number may still match the release. If the 150-page lag remains, collect a
WebKitGTK trace with held Backspace and scrolling, including Navigator state,
Page/Phone layout, GPU/Wayland details and whether spellcheck is enabled.
Chromium CDP timings cannot establish WebKitGTK, compositor or driver behavior.
No Fedora desktop, native WebKitGTK runtime or the reporter's hardware was
available for these measurements.
