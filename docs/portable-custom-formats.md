# Portable custom formats

Native scripts and backups save a complete custom format in `_templateSnapshot`, alongside `_templateId`. Built-in formats remain ID-only. Snapshot parsing validates rules, starter content, page geometry and nested settings before restoring a detached copy.

The library definition wins whenever its ID exists locally, so editing a library template continues to update existing scripts. The embedded definition is a fallback for devices without that template. Neither loading a script nor receiving a collaborative format adds anything to the recipient's library. OSF/Fade In formats use this same document-scoped path, including legacy `_templateSnapshot` data.

Formatting Template shows **This Document** only when the embedded definition differs from the library or has no library counterpart. If a local library definition exists, that is the active format. Choosing or editing the document definition gives it a separate ID, preserving the library copy and making the document choice explicit. Save to My Templates creates a reusable independent copy.

Malformed edits report an error and leave the editor dialog open; they do not show Template saved. Initial library hydration and reloads of identical definitions do not mark a document unsaved. Real format changes still use the existing metadata-save path.

Collaboration shares the complete format definition and page settings with the selected collaboration server and participants. A collaborator can choose or edit a document format and change the shared format/layout. Local libraries remain private and unchanged; a matching library ID takes precedence locally. No new external service is contacted. Font files are not embedded.

Regression coverage includes library precedence, subsequent library edits, clean-device fallback, OSF normalization, delayed library loading, validation failures, document-only edits, saved export resolution and Yjs metadata updates. DOCX dual-dialogue work is already on main and is outside this PR.
