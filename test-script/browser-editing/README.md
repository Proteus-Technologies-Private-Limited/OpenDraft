# Saved browser editing benchmark

Run against production previews, with real authenticated backend project/script
CRUD, autosave and browser recovery. Data is synthetic. The fixture server creates
its own database, data directory and short-lived credentials; it binds loopback.
Never use an existing account, shared backend, or user project.

## Setup

Use the Node/Python versions in the contributing guide and install the frontend
and backend dependencies. Install Playwright separately if your environment does
not already provide it:

```sh
npm install --prefix /tmp/od-editing-tools --no-save playwright
export NODE_PATH=/tmp/od-editing-tools/node_modules
export OPENDRAFT_CHROMIUM=/usr/bin/chromium
python test-script/browser-editing/server.py /tmp/od-editing-state
```

The state directory must not exist. It contains disposable test projects and
`auth.json` (mode 0600). Stop the server before removing that directory. Backend
port 8137 is reserved for this test; no collaboration service is needed. Do not
commit credentials, projects or browser storage.

In separate terminals, build and preview each revision. For readable CPU stacks,
use `npx vite build --minify false`; do not use the development server. Use the
same build options for both revisions and avoid building or testing while taking
measurements. For example, from each revision's `frontend` directory:

```sh
npx vite build --minify false
npx vite preview --host 127.0.0.1 --port 4187 --strictPort
```

Keep each preview serving its own output directory. Record the source revision
and any uncommitted patch hash. Reports also hash the served entry bundle, so a
label cannot silently substitute for build identity. Validate a standard minified
production build separately before submitting a change.

## Measure

From the repository root (change the label, port and output prefix per revision):

```sh
node test-script/browser-editing/run.mjs http://127.0.0.1:4187 REVISION /tmp/main-short /tmp/od-editing-state/auth.json short
node test-script/browser-editing/run.mjs http://127.0.0.1:4187 REVISION /tmp/main-150 /tmp/od-editing-state/auth.json 150
```

Optional arguments after the auth file are:
`[short|150] [off|profile] [page|speed] [on|off navigator] [on|off spellcheck]`.
Run one browser at a time. Alternate/reverse revision order across rounds. Compare
unprofiled runs first, then make **separate** CPU-sampled runs:

```sh
node test-script/browser-editing/run.mjs http://127.0.0.1:4187 REVISION /tmp/main-cpu /tmp/od-editing-state/auth.json 150 profile
node test-script/browser-editing/profile-summary.mjs /tmp/main-cpu.cpuprofile > /tmp/main-cpu-summary.json
```

Open the `.cpuprofile` in Chrome DevTools Performance/JavaScript Profiler to inspect
the complete call tree. Summary inclusive times overlap and must not be summed.

The harness creates a saved project, loads it through the normal editor route and
waits for dictionaries. It inserts 120 characters in a dialogue near the middle,
then deletes them with 120 Backspace keydowns (119 repeat events). It verifies:

- A **measured 150 pages** for the long fixture (3,110 blocks), rather than a page
  estimate from character count. The short control currently measures 11 pages.
- Active Page/Speed view, Navigator and spellcheck settings; `en_US` works and
  the common word “the” is not marked as misspelled.
- Exactly +120/-120 document size changes, 120 events per phase, the restored
  document and caret, successful backend saves, and actual recovery writes.
- A final backend GET contains the restored document body.

Autosave is set to the supported minimum **5 seconds** to exercise it during both
phases (the normal default is 30 seconds). This is a persistence stress condition.
The measurement interval includes the 1.5-second tail after each input phase;
reported saves/recovery also include final settling. Recovery timings measure
`localStorage.setItem`, not the whole serialization path. CPU traces include the
serialization work.

Requested typing/repeat delays are 50/33 ms. Playwright serializes input commands,
so these are not guaranteed hardware or OS repeat rates. Keydown-to-rAF-plus-timeout
is an **event-loop/render opportunity proxy**, not input-to-photon latency. CPU
metrics are CDP Task/Script/Layout/Style duration deltas. Headless Chromium on a
cloud VM cannot reproduce a reporter's browser, GPU, WebKitGTK or desktop session.
Do not claim the issue fixed on that hardware solely from these measurements.

Outputs: JSON with validated metrics and build/fixture hashes, a screenshot, and
optionally a CPU trace. A failed fixture is an invalid run, not a fast result.
Keep raw results out of the repo. The recorded comparison, CPU traces and their
limits are in the description and branch of
[PR #277](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/pull/277).
