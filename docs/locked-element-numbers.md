# Locked element references

In a format that enables element numbering, Tools → Production offers **Lock Element Numbers** and **Edit Element Number…**. These commands are hidden when the format numbers no elements.

Locking stores the current references on their paragraphs. New local insertions receive unused letter suffixes, such as 12A between 12 and 13. Existing references survive reflow, native saves, and undo/redo. Unlocking resumes automatic counting. An individual manual reference can be reset with **Use Automatic Number**.

FDX `Number` values on non-scene paragraphs import as stored element references. Only the paragraphs carrying those references are numbered; importing one action numbered 12 does not enable numbering for every action. Scene numbers continue to use the separate scene-numbering controls.

FDX export preserves stored references by default without enabling automatic numbering. Explicitly hiding element numbers suppresses them in the exported copy while retaining them in the native document. Existing legacy non-scene `sceneNumber` values retain their previous FDX export behavior.

Number repairs run on local edits, not incoming Yjs transactions. Ordinary unnumbered typing inspects inserted slices and attribute steps rather than scanning the document. Numbered document collections are cached by immutable document identity and reused by commands, decorations, and menus.
