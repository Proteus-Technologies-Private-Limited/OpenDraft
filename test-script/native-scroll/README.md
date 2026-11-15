# Native Linux scroll profiling (#229)

This uses **the actual Tauri/WebKitGTK window**, WebKitGTK's remote inspector,
and trusted XTest mouse-wheel events. It does not launch Playwright WebKit or
send synthetic DOM wheel events. See
[the investigation](../../docs/performance/issue-229-native-scroll.md) for results
and hardware limitations.

## Requirements

- Linux **X11** session (an isolated Xvfb display works), a native OpenDraft build
  with Tauri webview automation available, and its matching GTK/WebKitGTK libs.
- Node **22+** (global `WebSocket`), `bash`, `curl`, `xdotool`, `getconf`, and
  ImageMagick's `import` for a native-window screenshot.
- A spare/disposable display and **no other OpenDraft instance**. Close other
  tests/builds before measuring. This writes a synthetic document and changes
  preferences; never point it at a personal running app/profile.

```sh
# In a quiet X11 session, from the repo root:
bash test-script/native-scroll/launch.sh /absolute/path/to/opendraft /tmp/od-default
bash test-script/native-scroll/launch.sh /absolute/path/to/opendraft /tmp/od-compositing-off compositing-off

# Repeat in reverse order to check drift. Optional paint-only causal experiment:
OPENDRAFT_SHADOW_COMPARISON=1 bash test-script/native-scroll/launch.sh \
  /absolute/path/to/opendraft /tmp/od-shadow
```

For Xvfb, start a dedicated `Xvfb :97 -screen 0 1440x1000x24 -nolisten tcp`, set
`DISPLAY=:97` and optionally `OPENDRAFT_DISPLAY_PID` to its PID to record display
CPU separately. The harness resizes the native app to 1440×900. Pick a free
loopback inspector port with `OPENDRAFT_INSPECTOR_PORT` (default 9229). The
launcher stops only the app it launched and retains its disposable profile
path. Delete those test profiles when finished.

The launcher sets fresh `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and
`XDG_RUNTIME_DIR`, plus `TAURI_WEBVIEW_AUTOMATION=true` and
`WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:PORT`. The runner **asks native Tauri IPC
for its data/config/cache paths and requires an exact match before dismissing
recovery or replacing content**. A single-instance redirect to a personal app
therefore fails the storage check. The inspector is for local testing only;
it can execute JavaScript in the app. Stop the test process when finished.

If launching through a dependency namespace/container, supply the same flags
manually to `run.mjs`; `--pid` must be the actual OpenDraft process, not its
wrapper. Storage paths must remain visible at identical absolute paths in both
namespaces. The observed native app origin must be `tauri://localhost`.

## Workload and outputs

- Deterministic fixture: `screenplay(184)` with the last 14 blocks removed,
  3,110 blocks, **150 actual screenplay pages** at default Page layout, 100%
  zoom and Courier Prime. Verify fonts/layout/version when reproducing; the
  runner fails if `.page-sep-gap + 1` is not 150. The fixture generator's size
  argument is not a page count. `.page-sep` also includes a terminal footer and
  must not be used to count pages.
- Three rounds of all four Navigator/Auto Spell Check combinations, alternating
  configuration order; both down and up per combination. Navigator uses the
  default **Scenes** tab, spellcheck the bundled English dictionary. Menus are
  operated through the app's real handlers; decorations and panel state are
  checked before sampling.
- Twelve warmup notches in each direction. Each recorded phase starts near the
  middle of the script and sends 120 XTest wheel notches at requested 33 ms
  spacing, then observes a 600 ms tail. It checks trusted wheel input, scroll
  distance, unchanged document and selection, visibility and focus.
- `report.json`: per-phase rAF interval percentiles/counts, scroll/event totals,
  native version/executable hash, viewport/font/page count, fixture hash and
  process-tree CPU deltas. CPU uses `/proc/PID/stat` and `getconf CLK_TCK`; Web
  process, UI and display CPU remain separate. rAF intervals are **not**
  presentation latency or input-to-photon measurements. CPU totals can exceed
  wall time with multiple cores.
- `trace-*.json`: **separate profiled phases**, WebKit Timeline records and
  JavaScript samples. `Page.enable` is required for nonzero native timestamps;
  Timeline is enabled only once per inspector connection. Do not mix these
  samples into unprofiled timing comparisons. Timeline parent/child durations
  overlap; never add different record types as disjoint CPU costs.
- `native-window.png`: actual X11 window capture, synthetic text only.
- Optional `shadow-comparison/`: paired, order-alternating default-shadow, thin-outline and
  `box-shadow: none` runs with Navigator/spellcheck enabled. The CSS change is
  temporary, scoped to the disposable window, and checked not to alter page
  dimensions. It is an experiment, not a production change or a claimed fix.
  Use the **stock v2.13.0 app** for this comparison: a build already using the
  outline has no stock shadow to remove, so its `default` arm is different.

`default` preserves the app's automatic driver decision; `compositing-off`
sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` and
`WEBKIT_DISABLE_COMPOSITING_MODE=1`. These are **requests**. Record app logs,
GPU/device availability, WebKitGTK version and display backend alongside the
report. Without `/dev/dri`, neither run establishes accelerated DMA-BUF behavior.
XTest tests wheel notches, not touchpad/Wayland gesture handling. Repeat settings
and rendering comparisons on the reporter's actual hardware before concluding
#229 is fixed.

## Harness checks

```sh
node --test test-script/native-scroll/*.test.mjs
bash -n test-script/native-scroll/launch.sh
```

These exercise inspector multiplexing/error propagation, native IPC promises,
and frame sampler cleanup. They do not replace a native integration run.
