# Feature Gap Analysis: OpenDraft vs Fade In Professional

## Summary

This document identifies features present in **Fade In Professional Screenwriting Software** that are missing or incomplete in **OpenDraft** (v0.12.0). Features are categorized by priority based on how critical they are for professional screenwriting workflows.

---

## What OpenDraft Already Has (Parity with Fade In)

These features are already implemented and roughly at parity:

- **Script element types**: Scene Heading, Action, Character, Dialogue, Parenthetical, Transition, General, Shot, New Act, End of Act, Lyrics, Show/Episode, Cast List, Title Page
- **Dual Dialogue** support
- **Character name autocomplete** (built from document content)
- **Auto CONT'D / (MORE)** at page breaks (pagination engine + PDF export)
- **Scene Navigator** with scene list and synopsis
- **Index Cards** for visual scene organization
- **Notes & Annotations** (anchored script notes + general file-level notes, with color coding)
- **Find & Replace**
- **Spell Check** (with per-document ignore list)
- **Import**: Final Draft (.fdx), Fountain (.fountain), plain text
- **Export**: Final Draft (.fdx), Fountain (.fountain), PDF
- **Page Setup** (margins, page size)
- **Formatting templates** (industry standard + custom templates)
- **Bold / Italic / Underline / Strikethrough** styling
- **Text alignment** (left, center, right, justify)
- **Version history** (git-based check-in system)
- **Track Changes** (since last check-in)
- **Compare Versions** (diff viewer)
- **Real-time collaboration** (WebSocket-based)
- **Production tagging** (20+ built-in categories matching Final Draft TagData)
- **Character profiles** (name, description, color, gender, age, role, backstory, images)
- **Revision mode** with Hollywood standard color names (White, Blue, Pink, Yellow, Green, Goldenrod, etc.)
- **Dark / Light theme**
- **Beat Board** (outlining with columns, images, drag-and-drop)
- **Go to Page**
- **Cross-platform**: Desktop (macOS/Windows/Linux), Web, Mobile (Android)
- **Print** (browser print dialog)
- **PDF export** with proper screenplay formatting, page numbers, (MORE)/(CONT'D)

---

## Missing Features (Gaps)

### Priority 1 — Critical for Professional Use

| # | Feature | Fade In | OpenDraft Status |
|---|---------|---------|-----------------|
| 1 | **Scene Numbering** | Automatic scene numbers with lock/unlock. Inserted scenes get letter suffixes (5A, 5B). | Menu item exists but is **disabled** (`disabled: true`). Scene numbers are tracked internally but not rendered in the editor or PDF. |
| 2 | **Page Locking** | Lock page numbers so added/removed content doesn't shift page numbers during production. | Menu item exists but is **disabled** (`disabled: true`). Not implemented. |
| 3 | **Scene Locking** | Lock scene numbers so production departments maintain consistent references. | **Missing entirely.** No UI or backend support. |
| 4 | **Omitted Scenes** | Mark scenes as omitted while preserving scene number continuity. | **Missing entirely.** |
| 5 | **Headers & Footers** | Custom header/footer with dynamic fields (page number, date, title page bookmarks). | PDF export renders **page numbers only** in header. No custom header/footer editor. No dynamic fields. |
| 6 | **Colored Revision Pages** | Pages are physically colored per revision level. PDF output reflects page colors. Revision marks (asterisks) in margins. | Has revision **color labels** (White, Blue, Pink...) in status bar but **no actual colored page rendering** in editor or PDF. No revision marks/asterisks in margins. |
| 7 | **Statistics & Reports** | Scene Report, Character Report, Location Report, Cast Report. Exportable as HTML/CSV. | **Missing entirely.** No statistics, reports, word count, or scene length calculations. |
| 8 | **Character-specific Printing** | Print only pages containing a specific character's dialogue. | **Missing.** No selective printing by character or scene. |

### Priority 2 — Important for Workflow

| # | Feature | Fade In | OpenDraft Status |
|---|---------|---------|-----------------|
| 9 | **Full-Screen / Distraction-Free Mode** | Page-only full-screen editing. System UI hidden. Mouse reveals controls at screen edges. | **Missing.** CSS references to fullscreen exist only in panel expand buttons (notes, characters, index cards), not a dedicated writing mode. |
| 10 | **Dialogue Tuner** | View and edit all of a single character's dialogue in one place for voice consistency. | **Missing entirely.** Character profiles exist but no dialogue extraction/editing view. |
| 11 | **Watermarking** | Batch watermark PDFs with customizable text, opacity, position, orientation, font. | **Missing entirely.** No watermark support in PDF export. |
| 12 | **Global Character Rename** | Change a character name throughout the entire script in one operation. | **Missing.** Find & Replace can do text replacement but no character-aware rename that handles CONT'D extensions, dialogue attribution, etc. |
| 13 | **Bookmarks** | Named bookmarks to jump to specific locations in the script. | **Missing entirely.** Has Go to Page and Scene Navigator but no arbitrary bookmarks. |
| 14 | **Location Autocomplete** | Auto-complete for scene locations built from previously used locations. | **Missing.** Character autocomplete exists but no location/scene heading autocomplete. |
| 15 | **Custom Keyboard Shortcuts** | Full keyboard shortcut customization in preferences. | Shortcuts are **hardcoded** (Cmd+1-8 for elements, Cmd+B/I/U for styles). No customization UI. |
| 16 | **Auto-Save with Timestamped Backups** | Automatic periodic saves with recoverable timestamped backups. | Has manual save (Cmd+S) and project-based storage. **No automatic periodic save** or timestamped backup recovery system. |

### Priority 3 — Nice to Have

| # | Feature | Fade In | OpenDraft Status |
|---|---------|---------|-----------------|
| 17 | **Text-to-Speech / Table Read** | Virtual table read using system TTS voices to hear the script read aloud. | **Missing entirely.** |
| 18 | **Script Format Validation** | Check script for formatting errors and inconsistencies. | **Missing.** No validation or error-checking tool. |
| 19 | **Multi-Format Templates** | Built-in templates for stage plays, teleplays, radio plays, multimedia, graphic novels. | Formatting templates exist but are **screenplay-focused only**. No stage play, radio play, or graphic novel presets. |
| 20 | **Scene-Specific Printing** | Print only specific scenes or page ranges with a dedicated UI. | Print uses **browser print dialog** only. No scene-specific or page-range filtering in the app. |
| 21 | **Macro / Snippet System** | User-defined text macros and snippets for frequently used phrases or blocks. | **Missing entirely.** |
| 22 | **Custom User Dictionaries** | Personal dictionaries for spell check (proper nouns, made-up words). | Has per-document ignore list. **No persistent global user dictionary** across documents. |
| 23 | **Title Page Bookmarks / Dynamic Fields** | Title page fields that can be referenced in headers, footers, and exports as dynamic placeholders. | Has Title Page element type but **no bookmark/field system** for dynamic references. |
| 24 | **Script Comparison (Multi-Draft)** | Compare two arbitrary script files or drafts side by side. | Has "Compare with Version" for same-project versions. **Cannot compare two arbitrary files.** |
| 25 | **Multi-Cam Format** | Specialized formatting for multi-camera sitcom scripts (different margins, bold dialogue, etc.). | **Missing.** Only standard screenplay formatting. |
| 26 | **Revision Marks (Asterisks)** | Asterisk markers in the right margin indicating changed lines per revision. | **Missing.** Track Changes shows inline diffs but no margin asterisk markers. |

---

## Features Where OpenDraft Exceeds Fade In

OpenDraft has several features that Fade In lacks:

| Feature | Description |
|---------|-------------|
| **Beat Board** | Visual outlining board with columns, images, link previews, drag-and-drop — more powerful than Fade In's index cards |
| **Real-time Collaboration** | WebSocket-based live collaboration with auth, invitations, and role management |
| **Production Tags** | 20+ built-in tag categories for script breakdowns (Cast, Props, VFX, Costumes, etc.) |
| **Git-based Version Control** | Full version history with check-in/check-out, track changes against any version, diff viewer |
| **Character Backstory & Images** | Rich character profiles with backstory, images, and structured metadata |
| **Asset Manager** | File asset management integrated into the editor |
| **Plugin Architecture** | Extensible plugin system for adding features without modifying core |
| **Web + Mobile Access** | Browser-based access and Android app; Fade In is desktop-only (with separate mobile app) |
| **Open Source** | MIT-licensed, community-driven development |

---

## Recommended Implementation Order

Based on impact and complexity:

1. **Scene Numbering** (P1) — Foundation already exists (sceneNumber in data model). Needs rendering in editor + PDF + lock/unlock toggle.
2. **Statistics & Reports** (P1) — High user demand. Data is already in the editor; needs extraction + UI.
3. **Full-Screen Mode** (P2) — Low complexity, high perceived value.
4. **Headers & Footers** (P1) — Critical for production scripts. Extend PageSetupDialog + PDF exporter.
5. **Colored Revision Pages** (P1) — Revision colors exist in UI. Needs actual page coloring in editor + PDF.
6. **Page Locking** (P1) — Required for production workflows.
7. **Scene Locking** (P1) — Required for production workflows.
8. **Auto-Save** (P2) — Prevents data loss. High user trust impact.
9. **Dialogue Tuner** (P2) — Unique professional tool. Character data already exists.
10. **Watermarking** (P2) — Important for script distribution security.
