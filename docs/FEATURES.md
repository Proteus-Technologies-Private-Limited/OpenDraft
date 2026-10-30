# OpenDraft Features

A complete list of features in OpenDraft.

## Screenplay Editor

- **Industry-standard formatting** -- Scene headings, action, character, dialogue, parenthetical, transition, and shot elements with proper Courier Prime formatting
- **Character Autocomplete** -- Smart suggestions as you type character names
- **Macros** -- Insert text you type often (CONTINUOUS, a recurring location, a character with an extension) with a shortcut or from Edit → Insert Macro, optionally as a given element; export and import them as JSON
- **Scene Navigator** -- Jump between scenes instantly from the sidebar
- **Bookmarks** -- Name any line and jump back to it from the Navigator or Go to Page; saved with the script and shared with collaborators
- **Element Numbering** -- Number any element, not only scene headings: every line of dialogue, every sound effect or shot. The format chooses which elements are numbered, what restarts each count (a scene heading, a new act, any element) and an optional prefix such as FX 1. Shown in the margin on screen, in print, PDF, Word and Final Draft
- **Podcast format** -- Scripted podcast and audio fiction, with every line of dialogue numbered for the recording session and FX and music cues numbered on their own
- **Comic Book format** -- Full comic and graphic novel scripts: pages spelled out (PAGE ONE), panels numbered on each page, captions and balloons lettered across the page
- **Alternates** -- Keep other versions of a line of dialogue or action, or of a whole scene, beside it and switch between them; only the version showing prints and exports. During a live collaboration session the version shown stays editable, but adding, switching or deleting versions waits until the session ends (or you leave it), so two people switching at once cannot duplicate text
- **Distraction-free writing** -- Clean, focused interface with minimal chrome
- **Focus Mode** -- Full screen with panels and menus out of the way, typewriter scrolling, and optional dimming of all but the current element or scene
- **Writing Goals & Sprints** -- Daily and session goals in words or pages with a status bar progress ring, timed sprints with an optional no-backspace mode, and a words-written-per-day calendar in Script Statistics, kept on your device only

## Story Planning

- **Beat Board & Index Cards** -- Visual story planning with drag-and-drop scene organization
- **Plotlines & Story Timeline** -- Name the story's threads, put scenes and beats in them, and see every plotline across the script by screen time
- **Beats Linked to Scenes** -- Link a Beat Board beat to the scenes that carry it and jump straight to them; linked beats show on the Story Timeline
- **Character Profiles** -- Track characters with role types, highlight colors, and rich descriptions
- **Global Character Rename** -- Rename a character everywhere in one undoable step: cues keep their extensions, the profile, relationships and Cast tags follow, and mentions in action and dialogue are offered for review
- **Dialogue Tuner** -- Every line one character speaks, in order and with the line before for context, editable in place and playable in Table Read
- **Casting / Reference Images** -- Attach headshots or reference images to characters
- **Table Read** -- Hear the script read aloud with a voice per character and a live, word-by-word preview; device voices, free on-device Kokoro, or Gemini, OpenAI, ElevenLabs, Azure or your own speech server

## Project Management

- **Multiple Projects** -- Organize all your screenplays with metadata (genre, logline, synopsis)
- **Project Folders** -- On the desktop, save a project's scripts as files in any folder (external disk, RAID, network drive), with changes made elsewhere detected
- **Asset Management** -- Attach reference images, research docs, and notes to projects
- **Script Notes** -- Inline annotations for review and feedback, with threaded replies, resolve and reopen, assigning to a collaborator, and @mentions

## Version Control

- **Built-in Version History** -- Check in drafts at any point
- **Visual Diff** -- Compare any two versions side-by-side to see exactly what changed, with word-level marks for rewritten lines and moved lines and scenes detected
- **Restore** -- Roll back to any previous draft instantly

## Backups

- **Automatic Backups** -- Timestamped copies of your script written to a folder you choose, on an interval you set (desktop, iPad/iPhone and Android; on mobile a copy is also written whenever you leave the app)
- **Back Up Now** -- Pin the current moment on demand; manual backups are never deleted by the retention limit
- **Recover Backup** -- Browse every snapshot, preview it, and restore it as a new script or over the current one
- **Complete snapshots** -- Backups carry notes, tags, beats, character profiles and images, so a restore brings the script back whole

**Version History vs Backups:** Version History stores checkpoints *inside* OpenDraft's database and covers a whole project. Backups are ordinary files *outside* the app, one per script -- so they survive even if the database is lost. Use both.

## Collaboration

- **Real-time Co-editing** -- Multiple writers editing simultaneously with live cursors and presence
- **Permissions** -- Invite collaborators with Co-Edit, Suggest or Read Only access; the collaboration server enforces Suggest and Read Only
- **Suggest Mode** -- Edits proposed rather than made: typed words underlined, deleted words struck through, new lines, joins and type changes marked, each signed by its author, to accept or reject one at a time or all at once. For a collaborator invited to suggest, or for yourself (Tools → Suggest Changes)
- **Self-hosted** -- Run your own collaboration server for full privacy

## Import & Export

- **Dual dialogue in Word** -- Both speeches export in side-by-side columns with inline formatting and return as dual dialogue when imported. Long exchanges use Word's pagination.
- **Final Draft (.fdx)** -- Import and export
- **Fountain (.fountain)** -- Import and export
- **Fade In (.fadein) / Open Screenplay Format (.osf)** -- Import and export, carrying elements, emphasis, colour, fonts, page breaks, scene numbers, synopses, dual dialogue and the title page
- **Microsoft Word (.docx)** -- Import and export
- **OpenDraft (.odraft)** -- Lossless export: the script plus its notes, tags, beats, character profiles and images
- **Paste as Fountain** -- Paste Fountain markup straight into the script as real elements
- **PDF** -- Export with proper screenplay formatting, and import a screenplay PDF back into editable elements, checking and bulk-fixing misread lines in an Import Preview first
- **Highland (.highland), WriterDuet (.wdz), Celtx (.celtx)** -- Import, for writers switching from those apps
- **Open in place** -- Edit a `.fdx`, `.fountain`, `.fadein`, `.osf`, `.odraft` or `.txt` where it lives and save straight back to it, on desktop and mobile

## Editing Tools

- **Search & Replace** -- Find and replace across your screenplay
- **Spell Check** -- Built-in spell checker with custom dictionary support
- **Production Tags** -- Tag elements for production planning
- **Reports** -- Scene, character, location, cast, breakdown and notes reports, exported as CSV or PDF

## Production Output

- **Sides** -- Export the scenes an actor needs on their original pages, with the rest of each page crossed out
- **Selected Pages** -- Every page where a character speaks, every page at a location, or every page holding a tagged item, exported or printed (File → Print Selected Pages)
- **Two Pages per Sheet** -- Sides and selected pages side by side on landscape paper, each page keeping its own numbers
- **Watermarked PDF** -- A watermark on every page, with one copy per recipient carrying their name
- **Password-Protected PDF** -- A password to open the file, and printing or copying switched off

## Windows & Files

- **Multiple Windows** -- A second window on the desktop, on iPad, and on Android 12L and later, for writing in one script while reading another
- **One script, one window** -- Opening a screenplay that is already open elsewhere offers to switch to that window rather than open a copy that would save over it
- **Recover unsaved work** -- A per-window snapshot of the document you are editing, offered back if the app is closed or shut down before you saved

## Platform Support

- **Desktop** -- macOS (Apple Silicon), Windows, Linux (Debian, Fedora, AppImage)
- **Mobile** -- iOS (App Store) and Android (Google Play)
- **Browser** -- Self-hosted web version with full functionality
- **Offline** -- Everything works without an internet connection

## Privacy

- **100% Local Storage** -- All data stays on your machine
- **No Tracking** -- Zero analytics, zero telemetry
- **No Account Required** -- Install and start writing immediately
- **Open Source (MIT)** -- Full transparency, audit the code yourself

## Extensibility

- **Plugin Architecture** -- Extend OpenDraft with custom plugins: menu items, panels, routes, editor extensions, and importers, exporters and reports that join the built-in File and Analytics menus
- **Add-ons** -- Optional plugins, off until you turn them on in Settings → Add-ons. Turning one on shows what it does, what (if anything) leaves your device, and its settings; turning it off removes everything it added and can delete what it stored. AI features are only ever offered this way
- **Open API** -- FastAPI backend with documented endpoints
