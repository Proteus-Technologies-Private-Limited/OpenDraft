# Document layout and original-file safety

New screenplays and Page Setup → Reset to Default use US Letter (8.5 × 11 inches), with 1.5-inch left and 1-inch right, top and bottom margins. Existing documents keep their saved settings. Selecting A4 changes the paper dimensions while preserving the writer's margins. For an Australian layout, Screen Australia's guidance suggests 3.9 cm left and 2.5 cm right, top and bottom; this is regional guidance, not a universal A4 standard.

`PageLayout` retains its existing storage schema for compatibility: width, height and side margins are inches; top, bottom, header and footer margins are points. `layoutUnits.ts` provides explicit conversions. OSF dimensions are tenths of a millimetre (254 units per inch). Do not migrate existing numbers without converting their units.

OSF and Fade In import supported page dimensions, margins and inherited built-in element styles into the existing layout/template models. The imported template is embedded in `.odraft` saves, so reopening does not depend on a locally installed template. Title-page construction uses the imported geometry. Fade In export, in-place Save and linked OSF serialization share the same exporter and use document settings.

Older OpenDraft versions may discard the embedded imported template and conversion warnings when saving a working copy. Keep the original and its recovery backups independently.

Unsupported line-spacing multipliers, keep-with-next choices and source style/settings attributes are retained in source metadata where possible and reported as warnings. Custom styles may be mapped to a built-in element; their per-paragraph appearance is not guaranteed. Unsupported document sections and application-specific data can still be lost. Preserving supported measurements does not guarantee identical pagination across rendering engines. Exporting an external format does not preserve all OpenDraft metadata; use `.odraft` for a full working copy.

## Saving an original

Opening successfully never establishes lossless compatibility. Saving over an external screenplay requires a review with import warnings and three choices:

- **Save a Copy** opens a separate save/export operation with a different suggested name. It does not mark the original as updated. Use **Save As** to keep a full `.odraft` working copy.
- **Cancel** leaves the original unchanged.
- **Overwrite Original** requires checking an acknowledgement of potential information loss.

Replacement output is parsed before asking for consent. Desktop saves write and verify a unique temporary file beside the destination, create and verify a byte-for-byte original backup, then rename the temporary file over the destination. A failed backup or replacement aborts the save; there is no delete-original fallback. Backups are in `.opendraft-originals` beside the source. Copy the desired timestamped version back using the file manager. Backups are not automatically pruned.

On iOS and Android, provider writes may not support atomic replacement. OpenDraft first reads the original bytes and persists a verified copy in its `source-backups` application-data folder. **File → Recover Original File** exports those raw bytes without replacing the working document or deleting the backup. Backups are local to the device; removing app data also removes them.

Background saves keep external source files pending instead of repeatedly prompting or silently overwriting them. Use Save for explicit review of a linked file, or keep a native working copy. Library autosaves remain available.

## Desktop file associations

OpenDraft owns `.odraft`. macOS registers other supported screenplay formats at `Alternate` rank. Both Windows NSIS and MSI advertise them through named `OpenWithProgids` entries and OpenDraft-owned classes only. Install/uninstall never writes the external extension's default value or Windows `UserChoice`. `.txt` remains importable but has no installer association. Existing user preferences are not migrated or reset.

## Validation limits

Automated tests cover repeated Letter/A4 OSF and Fade In conversions, inherited styles, source settings, saved-template restoration, linked serialization, consent/cancellation and failed original-file replacement. Browser checks exercise the real overwrite dialog and editor CSS in a multi-page harness. Windows/macOS installation, mobile document-provider recovery and cross-application rendering still require device testing.

## UI screenshots

These browser-harness captures use the real editor stylesheet and save-review component.

![Draggable document scrollbar](screenshots/editor-scrollbar.png)

![Original-file save review](screenshots/original-save-review.png)
