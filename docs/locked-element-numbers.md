# Locked element references

Tools → Production offers **Lock Element Numbers** and **Edit Element Number…** when the format enables numbering or the document already contains stored references. With an unnumbered format, locking affects only those existing references and does not number other paragraphs.

Locking stores the current references on their paragraphs. New local insertions receive unused letter suffixes, such as 12A between 12 and 13. Existing references survive reflow, native saves, and undo/redo. Unlocking resumes automatic counting. An individual manual reference can be reset with **Use Automatic Number**.

FDX `Number` values on non-scene paragraphs import as stored, unlocked element references. Importing does not lock the entire numbering sequence; the writer chooses whether to lock it. Only the paragraphs carrying those references are numbered; importing one action numbered 12 does not enable numbering for every action. Scene numbers continue to use the separate scene-numbering controls.

FDX export preserves stored references by default without enabling automatic numbering. Explicitly hiding element numbers suppresses them in the exported copy while retaining them in the native document. Existing legacy non-scene `sceneNumber` values retain their previous FDX export behavior.

Number repairs run on local edits, not incoming Yjs transactions. Ordinary unnumbered typing inspects inserted slices and attribute steps rather than scanning the document. Numbered document collections are cached by immutable document identity and reused by commands, decorations, and menus.

When a new reference must fit between a number and its first suffix (for example 1 and 1A), it uses the existing prefix-before-following convention: A1A goes before 1A. This avoids assigning 1B after 1A. Existing 2A/2B → 2AA and 1Z → 1AA allocation remains unchanged.

## Concurrent insertions

Two collaborators can independently insert at the same locked reference and both allocate 12A. Yjs preserves both paragraphs and their distinct IDs, but the duplicate labels remain: remote updates deliberately do not trigger numbering repairs, and existing source labels are preserved on later local edits. A real Yjs merge regression covers this limitation. Coordinate locked-number edits or use **Edit Element Number…** to assign a distinct reference to one insertion after syncing. This change does not automatically renumber established production references across collaborators.
