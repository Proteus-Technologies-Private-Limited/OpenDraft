# Locked element references

Tools → Production offers **Lock Element Numbers** and **Edit Element Number…** when the format enables numbering or the document already contains stored references. With an unnumbered format, locking affects only those existing references and does not number other paragraphs.

Locking stores the current references on their paragraphs. New local insertions receive unused letter suffixes, such as 12A between 12 and 13. Existing references survive reflow, native saves, and undo/redo. Unlocking resumes automatic counting. An individual manual reference can be reset with **Use Automatic Number**.

FDX `Number` values on non-scene paragraphs import as stored, unlocked references that use automatic counting when the active format numbers their element type. Inserting or deleting a line after an FDX round trip therefore renumbers the following lines instead of creating duplicate anchors. Without a matching counter, the original sparse references remain visible. Importing does not lock the entire numbering sequence; the writer chooses whether to lock it. In an unnumbered format, only paragraphs carrying references display numbers; importing one action numbered 12 does not enable a counter for other actions. Scene numbers continue to use the separate scene-numbering controls.

Stored action, shot and dialogue references are intended to be visible production labels, including references imported from Final Draft. PDF, DOCX and FDX exports preserve them by default without enabling new automatic counters when export options are omitted. Explicitly hiding element numbers suppresses them in the exported copy while retaining them in the native document. Existing legacy non-scene `sceneNumber` values retain their previous FDX export behavior.

Number repairs run on local editor edits, not incoming Yjs transactions or suggestion rewrites. A suggester can type into a previously empty line in a locked sequence without sending forbidden numbering housekeeping. Enter at the start of an Action or General line leaves the reference on its original text, and an internal drag move carries its reference; a pasted or dragged copy still drops collisions. Ordinary unnumbered typing inspects inserted slices and attribute steps rather than scanning the document. Numbered document collections are cached by immutable document identity and reused by commands, decorations, and menus.

When a new reference must fit between a number and its first suffix (for example 1 and 1A), it uses the existing prefix-before-following convention: A1A goes before 1A. Inserting again between 1 and A1A gives AA1A, rather than 1B. Existing 2A/2B → 2AA and 1Z → 1AA allocation remains unchanged.

Older native documents may contain unlocked stored anchors without the automatic flag. Automatic labels skip those anchors to avoid duplicates. With a numbering format active, **Use Automatic Element Numbers** resumes the counter in bulk without requiring a lock/unlock cycle. Source labels remain in the native data; unrelated references outside the format’s counters are unchanged.

The number dialog follows a stored reference by its stable ID through remote text edits and whole-document Yjs replacements. It refuses a save if the reference is removed, duplicated or renumbered remotely, rather than applying the edit to another paragraph. References without IDs follow ordinary transaction position mappings; a whole-document replacement may require reopening their dialog.

## Concurrent insertions

Two collaborators can independently insert at the same locked reference and both allocate 12A. Yjs preserves both paragraphs and their distinct IDs, but the duplicate labels remain: remote updates deliberately do not trigger numbering repairs, and existing source labels are preserved on later local edits. A real Yjs merge regression covers this limitation. Coordinate locked-number edits or use **Edit Element Number…** to assign a distinct reference to one insertion after syncing. This change does not automatically renumber established production references across collaborators.
