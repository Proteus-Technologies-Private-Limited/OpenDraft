# File-save diagnostics

**Help → Diagnostics** shows the most recent file-operation failure from the
current session. **Copy Report** includes the same timestamp, operation, format,
stage, native command (where applicable) and original error text. Reopen the
dialog to collect a new snapshot after another failure.

The version comes from the packaged native app through Tauri's `getVersion`.
Browser builds, and native builds whose version API is unavailable, use the
version bundled from `src-tauri/tauri.conf.json`. Update checks use the same
native lookup. There is no separate manually maintained version fallback.

The shared desktop writer identifies failures with the stable, readable prefix
`Save failed during <stage>:`:

| Stage | Operation that failed |
| --- | --- |
| `destination` | Resolve the destination or prepare its parent directory |
| `staging` | Create, write, flush or verify the temporary output |
| `backup` | Read the original, persist its verified recovery copy, or check it has not changed |
| `replacement` | Preserve destination permissions or replace/write the destination |
| `cleanup` | Remove the staging file after a hard-linked file was written |

The frontend reads these explicit prefixes. An OS error code alone does not
identify the phase. Adapters without a phase prefix retain `native-write` or
`share`, along with the command and original platform error. Browser download,
dialog and save-copy validation failures have their own contextual stages.
Formatting/serialization errors before the file-operation adapter are outside
this recorder's scope.

The recorder keeps one bounded failure in memory, not file contents, byte
buffers or IPC argument objects. It stores the file extension rather than the
destination path; the original error text may itself contain a path. Nothing is
uploaded automatically or persisted by this recorder. Restarting/reloading
clears it. Successful saves and cancelled dialogs do not replace the historical
failure; its timestamp and the label “this session” distinguish it from current
save status. Cancelling the external-file overwrite review does not record a
write failure because no write was attempted.

Native writes retain their existing backup, verification, replacement and
cleanup behavior. This change adds context to errors, rather than retrying
failed writes or changing permissions.

## Validation

- `appVersion.test.ts`: browser version, native override, concurrent lookups,
  cached success and fallback/retry.
- `fileDiagnostics.test.ts`: text/binary/in-place/mobile/browser failures,
  cancellation/success behavior, original exception preservation, bounded
  snapshots and copied report content.
- `safe_file.rs`: native destination/staging/backup/replacement failures and
  original/backup preservation. These tests also run in the existing Rust CI job.
- With Vite and Python Playwright installed, run
  `OPENDRAFT_TEST_URL=http://127.0.0.1:5173/ python test-script/file_diagnostics.py`
  to exercise the real dialog and clipboard with synthetic native IPC. This is
  browser integration evidence; it does not establish physical-device behavior.
