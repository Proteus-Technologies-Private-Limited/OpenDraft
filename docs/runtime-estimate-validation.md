# Runtime Estimate — Validation Against Released Films

Issue #144 reported that the status bar's **Est.** runtime ran well short of
Fade In and Screenweaver. This records how the replacement estimate
(`frontend/src/utils/scriptTiming.ts`) was checked against real films.

## How the estimate works

A screenplay page is ~55 lines of 12pt Courier, and the industry rule of thumb
is one page ≈ one minute. The estimate counts **printed lines** the way the
editor's paginator does:

- each element wrapped at its own column width (action 62 chars, dialogue 36,
  parenthetical 26, …)
- the blank lines the template puts above each element (two above a scene
  heading, one above action and character cues)
- character cues, scene headings and transitions as lines of their own

Minutes = lines ÷ lines-per-page × the template's page time (60 s for a
screenplay, 30 s for a multi-cam sitcom). Title page, Sections and Notes are
excluded. Per-scene manual timing overrides still win.

The old estimate counted words at 250 per page (a prose page; a script page
carries ~150–230) and gave cues, headings and white space no time.

## Ground truth

Scripts with a known on-screen result: 11 studio "For Your Consideration"
releases (A24, Disney, Deadline-hosted), plus *Big Fish* (the Fountain sample
production draft) and *12 Years a Slave*.

The target is **story time = theatrical runtime − end credits**, because no
script contains the credit roll. Credits lengths are from RunPee where found
(±1 min) and estimated at 5.5–6.5 min otherwise.

## Results

| Film | Story (min) | PDF pages | Old est. | New est. | PDF pages @ 1 min |
|---|---|---|---|---|---|
| 12 Years a Slave* | 128 | – | +2% | +15% | +20% |
| A Real Pain | 84 | 100 | −30% | +23% | +20% |
| Amsterdam | 127 | 143 | −31% | +13% | +13% |
| Babygirl | 108 | 90 | −37% | −15% | −17% |
| Big Fish* | 119 | – | −21% | +5% | +7% |
| Civil War | 102 | 110 | −37% | +12% | +8% |
| Don't Look Up | 129 | 126 | −43% | −4% | −2% |
| Elvis | 150 | 175 | −18% | +19% | +17% |
| Heretic | 104 | 124 | −24% | +8% | +19% |
| Queer* | 132 | 102 | −32% | −24% | −22% |
| Sing Sing* | 101 | 76 | −46% | −27% | −25% |
| Women Talking* | 98 | 124 | −20% | +8% | +27% |
| The Zone of Interest* | 100 | 74 | −43% | −26% | −26% |

\* credits length estimated. Page counts for *12 Years a Slave* and *Big Fish*
come from OpenDraft's own pagination.

| Method | Bias | Mean abs. error |
|---|---|---|
| Old estimate (words) | −29% | 29.4% |
| **New estimate (printed lines)** | **+1%** | **15.2%** |
| Published page count, 1 min/page | +3% | 17.0% |
| Per-element weights, leave-one-out | −3% | 17.3% |

- The old estimate was 20–46% short on 12 of 13 films. That is the #144 report.
- The new estimate has essentially no bias, and per film it is slightly closer
  than the published page count.
- The remaining ±15% is pacing, which no page measure can see. Slow,
  image-led films (*The Zone of Interest*, *Sing Sing*, *Queer*) run long for
  their pages; dense, quick-talking ones (*A Real Pain*, *Elvis*) run short.
- Weighting dialogue and action differently (best fit: dialogue 0.75×, action
  1.18×) looked better in-sample but was worse on films it had not seen, so
  every printed line counts the same.

## Pacing setting (Format ▸ Genre & Pacing…)

The ±15% that is left is directing pace, which the page cannot show — but the
writer usually knows it. Each script can set a **Pacing**, saved in the file
as `_scriptProfile` and applied to the whole estimate (never to scene timings
typed in by hand):

| Pacing | Multiplier | For |
|---|---|---|
| Brisk | 0.85× | fast-talking, quick cutting |
| Standard (default) | 1.0× | one page ≈ one minute |
| Measured | 1.3× | slow-burn, contemplative, long silences |

Labelling only the films whose pace is unambiguous (Brisk: *A Real Pain*,
*Elvis*; Measured: *The Zone of Interest*, *Sing Sing*, *Queer*; the rest
Standard):

| Method | Bias | Mean abs. error |
|---|---|---|
| New estimate, all Standard | +1% | 15.2% |
| **New estimate with pacing** | **+3%** | **7.2%** |

Read this as an upper bound: the multipliers are the middle of those same
films' errors, and the labels were assigned knowing how the films play. It
shows the setting does the right thing in the right direction; a writer's own
label in advance will be noisier than this.

**Genre** is stored too (any of the suggested genres, plus the writer's own)
but does not affect the estimate: dramas ranged −27% to +8% and comedies −4%
to +23%, so genre carries no runtime signal.

## Reproducing

```bash
# 1. Rebuild element JSON from screenplay PDFs (OpenDraft has no PDF import)
python3 test-script/pdf_screenplay_to_json.py test-script/output/runtime-check path/to/*.pdf

# 2. Score old / new / paced / page count against test-script/runtime-truth.csv
cd frontend
RUNTIME_FILES="$(ls ../test-script/output/runtime-check/* | tr '\n' ':')" \
  npx vitest run --config ../test-script/vitest.config.ts runtime-estimate-check \
  --disable-console-intercept
```

`.fdx`, `.odraft` and `.fountain` files can go in `RUNTIME_FILES` directly.
The PDFs are not checked in; the studio links are listed at
simplyscripts.com/oscar-screenplays-97.html.
