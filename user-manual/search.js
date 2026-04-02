/**
 * OpenDraft User Manual - Client-side Search Engine
 * Indexes all manual pages and provides instant search.
 */

(function () {
  'use strict';

  // Search index: each entry has page, title, section, text, url
  const searchIndex = [
    // Index / Home
    { page: 'Home', title: 'Welcome to OpenDraft', section: '', text: 'Free open-source screenwriting application. Professional screenplay editing with real-time collaboration. No subscription required.', url: 'index.html' },
    { page: 'Home', title: 'Quick Start', section: 'Quick Start', text: 'Install OpenDraft download desktop app. Create a project. Start writing new script. Save your work Cmd S check in version checkpoint.', url: 'index.html#quick-start' },
    { page: 'Home', title: "What's New in v0.5.0", section: "What's New", text: 'Beat board visual story planning drag-drop cards colors images resize FDX import export. Redesigned tags notes two-tab panel smart toolbar tagging annotation. Smoother zooming dampened pinch-to-zoom editor scaling. Windows compatibility file operations executable. Spell checker robust async initialization error handling. Accessibility aria labels UI controls screen reader. Error logging backend exceptions debugging.', url: 'index.html#whats-new' },

    // Getting Started
    { page: 'Getting Started', title: 'Getting Started', section: '', text: 'Write your first screenplay in 5 minutes. Beginner guide walkthrough basics. New to screenwriting software.', url: 'getting-started.html' },
    { page: 'Getting Started', title: 'The Interface', section: 'Interface', text: 'Menu bar toolbar editor side panels status bar. Quick buttons formatting element type font zoom search. Main writing area screenplay pages. Scene navigator index cards characters tags.', url: 'getting-started.html#the-interface' },
    { page: 'Getting Started', title: 'Create a Project', section: 'Create Project', text: 'New project button projects screen. Give project name create. Scripts assets versions tabs.', url: 'getting-started.html#create-project' },
    { page: 'Getting Started', title: 'Create a Script', section: 'Create Script', text: 'New script inside project. Give script name. Click script open editor.', url: 'getting-started.html#create-script' },
    { page: 'Getting Started', title: 'Write Your First Scene', section: 'First Scene', text: 'Scene heading INT EXT location time day. Action describe what we see. Character name dialogue. Parenthetical acting direction. Cmd 1 through 8 element types.', url: 'getting-started.html#write-first-scene' },
    { page: 'Getting Started', title: 'Save Your Work', section: 'Save', text: 'Quick save Cmd S. Check in file menu version checkpoint. Save point restore. Version history.', url: 'getting-started.html#save-work' },
    { page: 'Getting Started', title: 'Explore Panels', section: 'Panels', text: 'Navigator scenes jump. Index cards visual rearranging. Beat board story planning. Characters profiles stats. Script notes annotations. Tags production tagging.', url: 'getting-started.html#explore-panels' },

    // Installation
    { page: 'Installation', title: 'Installation', section: '', text: 'Get OpenDraft running on your computer. Download install desktop app. Browser self-hosted.', url: 'installation.html' },
    { page: 'Installation', title: 'macOS Installation', section: 'macOS', text: 'Download DMG file. Drag OpenDraft into Applications folder. Apple Silicon. Gatekeeper unidentified developer system settings privacy security open anyway.', url: 'installation.html#macos' },
    { page: 'Installation', title: 'Windows Installation', section: 'Windows', text: 'Download EXE installer or MSI. Run installer follow prompts. Start menu.', url: 'installation.html#windows' },
    { page: 'Installation', title: 'Linux Installation', section: 'Linux', text: 'Ubuntu Debian DEB package. Fedora RHEL RPM. AppImage portable. dpkg rpm install commands.', url: 'installation.html#linux' },
    { page: 'Installation', title: 'Run in Browser', section: 'Browser', text: 'Self-hosted browser. Python 3.12 Node.js 18 Git requirements. Setup script clone install. localhost 8000. Manual setup venv pip npm.', url: 'installation.html#browser' },

    // Writing Your Screenplay
    { page: 'Writing Your Screenplay', title: 'Writing Your Screenplay', section: '', text: 'Editor screenplay elements auto-formatting. Paginated view page breaks. Page count status bar. Zoom control.', url: 'writing-screenplay.html' },
    { page: 'Writing Your Screenplay', title: 'The Editor', section: 'Editor', text: 'Word processor designed for screenwriting. Formatted pages print view. Page count status bar. Go to page Cmd G. Zoom 50 to 200 percent.', url: 'writing-screenplay.html#the-editor' },
    { page: 'Writing Your Screenplay', title: 'Screenplay Elements', section: 'Elements', text: 'Scene heading action character dialogue parenthetical transition general shot. INT EXT location time of day. Element types formatting industry standards.', url: 'writing-screenplay.html#screenplay-elements' },
    { page: 'Writing Your Screenplay', title: 'Scene Heading', section: 'Elements', text: 'Scene heading Cmd 1. Establishes location time of day. Always uppercase. INT OFFICE DAY. EXT PARK NIGHT.', url: 'writing-screenplay.html#primary-elements' },
    { page: 'Writing Your Screenplay', title: 'Action', section: 'Elements', text: 'Action Cmd 2. Describes what we see and hear. Regular paragraph text. Sarah enters room.', url: 'writing-screenplay.html#primary-elements' },
    { page: 'Writing Your Screenplay', title: 'Character Element', section: 'Elements', text: 'Character Cmd 3. Name of speaking character. Centered uppercase. SARAH.', url: 'writing-screenplay.html#primary-elements' },
    { page: 'Writing Your Screenplay', title: 'Dialogue', section: 'Elements', text: 'Dialogue Cmd 4. What character says. Centered narrower margins.', url: 'writing-screenplay.html#primary-elements' },
    { page: 'Writing Your Screenplay', title: 'Parenthetical', section: 'Elements', text: 'Parenthetical Cmd 5. Acting direction within dialogue. Whispering. In parentheses.', url: 'writing-screenplay.html#primary-elements' },
    { page: 'Writing Your Screenplay', title: 'Transition', section: 'Elements', text: 'Transition Cmd 6. Editing transitions. Right-aligned uppercase. CUT TO. FADE OUT.', url: 'writing-screenplay.html#primary-elements' },
    { page: 'Writing Your Screenplay', title: 'Additional Elements', section: 'Elements', text: 'New act end of act lyrics show episode cast list. TV scripts format menu.', url: 'writing-screenplay.html#additional-elements' },
    { page: 'Writing Your Screenplay', title: 'Switching Elements', section: 'Switching', text: 'Keyboard shortcut Cmd 1 through 8. Toolbar dropdown element type. Format menu. Auto-switching after enter scene heading to action character to dialogue.', url: 'writing-screenplay.html#switching-elements' },
    { page: 'Writing Your Screenplay', title: 'Character Autocomplete', section: 'Autocomplete', text: 'Character autocomplete suggestions. Typing character element name suggestions dropdown. Consistent spelling.', url: 'writing-screenplay.html#character-autocomplete' },
    { page: 'Writing Your Screenplay', title: 'Undo and Redo', section: 'Undo Redo', text: 'Cmd Z undo. Shift Cmd Z redo. Multiple steps history.', url: 'writing-screenplay.html#undo-redo' },

    // Formatting
    { page: 'Formatting', title: 'Formatting', section: '', text: 'Bold italic underline fonts text styling. Screenplay formatting conventions.', url: 'formatting.html' },
    { page: 'Formatting', title: 'Text Styling', section: 'Text Style', text: 'Bold Cmd B. Italic Cmd I. Underline Cmd U. Toggle style. Toolbar buttons. Select text apply style.', url: 'formatting.html#text-style' },
    { page: 'Formatting', title: 'Fonts', section: 'Fonts', text: 'Courier font 12pt size. Courier Prime default modern readable. Courier New classic. Courier Final Draft. Font dropdown toolbar. Page-level character-level.', url: 'formatting.html#fonts' },
    { page: 'Formatting', title: 'Font Size', section: 'Font Size', text: 'Standard 12pt. Adjust 8pt to 72pt. Size dropdown toolbar. Page count accuracy.', url: 'formatting.html#font-size' },
    { page: 'Formatting', title: 'Format Panel', section: 'Format Panel', text: 'Right-click format panel dialog. Live preview formatting changes. Element-specific font size alignment margins spacing.', url: 'formatting.html#format-panel' },
    { page: 'Formatting', title: 'Zoom', section: 'Zoom', text: 'Editor zoom level toolbar. 50 percent to 200 percent range. Display only not print.', url: 'formatting.html#zoom' },

    // Find & Replace
    { page: 'Find & Replace', title: 'Find & Replace', section: '', text: 'Search screenplay replace text quickly. Cmd F open find.', url: 'find-replace.html' },
    { page: 'Find & Replace', title: 'Finding Text', section: 'Find', text: 'Cmd F open find replace panel. Type search term. Matches highlighted real-time. Arrow buttons jump between matches. Draggable panel move anywhere.', url: 'find-replace.html#finding-text' },
    { page: 'Find & Replace', title: 'Search Options', section: 'Options', text: 'Match case Sarah SARAH. Whole word matching. Case-insensitive search.', url: 'find-replace.html#search-options' },
    { page: 'Find & Replace', title: 'Replacing Text', section: 'Replace', text: 'Replace field replacement text. Replace current match. Replace all every match. Rename character old name new name.', url: 'find-replace.html#replacing-text' },

    // Spell Check
    { page: 'Spell Check', title: 'Spell Check', section: '', text: 'Catch typos spelling errors. Red squiggly underline misspelled words.', url: 'spell-check.html' },
    { page: 'Spell Check', title: 'Enable Spell Check', section: 'Enable', text: 'Toggle spell check tools menu. Misspelled words red squiggly underline.', url: 'spell-check.html#enable' },
    { page: 'Spell Check', title: 'Fix Misspelled Word', section: 'Fix', text: 'Right-click underlined word. Context menu spelling suggestions. Click suggestion replace.', url: 'spell-check.html#fix-word' },
    { page: 'Spell Check', title: 'Custom Dictionary', section: 'Dictionary', text: 'Add to dictionary character names fictional places. Ignore skip instance. Custom dictionary never flagged.', url: 'spell-check.html#custom-dictionary' },

    // Scene Navigator
    { page: 'Scene Navigator', title: 'Scene Navigator', section: '', text: 'Jump between scenes script structure at a glance. Side panel navigation.', url: 'scene-navigator.html' },
    { page: 'Scene Navigator', title: 'Scenes Tab', section: 'Scenes', text: 'Lists every scene heading in order. Scene heading text number. Click scene jump to. Fast navigate long screenplay. Updates real-time.', url: 'scene-navigator.html#scenes-tab' },
    { page: 'Scene Navigator', title: 'Locations Tab', section: 'Locations', text: 'Groups scenes by location. Coffee shop interior exterior day night grouped. Shooting schedule planning. Click scene jump.', url: 'scene-navigator.html#locations-tab' },
    { page: 'Scene Navigator', title: 'Go to Page', section: 'Go to Page', text: 'Cmd G go to page dialog. Type page number enter jump directly.', url: 'scene-navigator.html#go-to-page' },

    // Index Cards
    { page: 'Index Cards', title: 'Index Cards', section: '', text: 'Visual card-based scene browser. Corkboard view. Drag-and-drop scene reordering.', url: 'index-cards.html' },
    { page: 'Index Cards', title: 'Scene Cards', section: 'Cards', text: 'Each card shows scene heading location time. Synopsis brief summary. Click synopsis type description.', url: 'index-cards.html#scene-cards' },
    { page: 'Index Cards', title: 'Reorder Scenes', section: 'Reorder', text: 'Drag-and-drop scene reordering. Click hold card drag new position. Moves actual scene content. Undo Cmd Z.', url: 'index-cards.html#reorder-scenes' },
    { page: 'Index Cards', title: 'Fullscreen Mode', section: 'Fullscreen', text: 'Fullscreen toggle expand index cards entire window. Distraction-free story structure corkboard.', url: 'index-cards.html#fullscreen' },

    // Beat Board
    { page: 'Beat Board', title: 'Beat Board', section: '', text: 'Plan story structure beats organized by act. Story events turning points. Three-act structure.', url: 'beat-board.html' },
    { page: 'Beat Board', title: 'Working with Beats', section: 'Beats', text: 'Add beat button. Title short name inciting incident. Description what happens. Edit delete beats. Outline planning.', url: 'beat-board.html#working-with-beats' },
    { page: 'Beat Board', title: 'Acts', section: 'Acts', text: 'Three-act structure. Act 1 setup introduce characters 25 percent. Act 2 confrontation rising action 50 percent. Act 3 resolution climax 25 percent. TV scripts multiple acts.', url: 'beat-board.html#acts' },

    // Characters
    { page: 'Characters', title: 'Characters', section: '', text: 'Character profiles rich text backstory images dialogue stats scene appearances. Cast management tracking role gender age.', url: 'characters.html' },
    { page: 'Characters', title: 'Character Statistics', section: 'Stats', text: 'Dialogue count lines. Scene appearances number. First appearance which scene. Scene list all appearances.', url: 'characters.html#character-stats' },
    { page: 'Characters', title: 'Character Profiles', section: 'Profiles', text: 'Description rich text bold italic underline bullet list. Role lead supporting featured background day player. Gender. Age. Backstory character history motivations secrets. Highlight color. Final Draft Character Navigator fields.', url: 'characters.html#profiles' },
    { page: 'Characters', title: 'Rich Text Editing', section: 'Rich Text', text: 'Mini rich text editor formatting toolbar. Bold italic underline bullet list. Description backstory fields. Structure character information traits goals relationships.', url: 'characters.html#rich-text' },
    { page: 'Characters', title: 'Character Images', section: 'Images', text: 'Associate images headshots costume reference mood boards. Upload image from computer. From assets picker existing project images. Avatar circular thumbnail collapsed view. Primary image lightbox full size. Star set primary. Remove unlink association.', url: 'characters.html#images' },
    { page: 'Characters', title: 'Build from Script', section: 'Build', text: 'Build from script auto extract character information. Scans action lines introductions. Age description auto populated. ALL CAPS convention.', url: 'characters.html#build-from-script' },
    { page: 'Characters', title: 'Character Highlighting', section: 'Highlighting', text: 'Highlight color character dialogue tinted. Tools character highlighter. 12-color palette auto assigned. Visual scan who speaking.', url: 'characters.html#highlighting' },
    { page: 'Characters', title: 'Sorting Characters', section: 'Sort', text: 'Sort by name alphabetical. Importance dialogue lines. Scenes appearances. Dialogues count. Appearance first order.', url: 'characters.html#sorting' },

    // Script Notes
    { page: 'Script Notes', title: 'Script Notes', section: '', text: 'Annotations reminders reference material. Anchored notes color-coded. Media embedding.', url: 'script-notes.html' },
    { page: 'Script Notes', title: 'Creating a Note', section: 'Create', text: 'Select text annotate. New note button. Type note text. Anchored to selected text. Stays connected through edits.', url: 'script-notes.html#create-note' },
    { page: 'Script Notes', title: 'Note Colors', section: 'Colors', text: 'Yellow general reminders. Red issues problems. Blue research references. Green approved completed. Orange feedback collaborators. Purple creative ideas alternatives.', url: 'script-notes.html#note-colors' },
    { page: 'Script Notes', title: 'Embedding Media', section: 'Media', text: 'Images reference photos mood boards. Videos YouTube Vimeo URLs. Asset references @AssetName syntax link project assets.', url: 'script-notes.html#media' },
    { page: 'Script Notes', title: 'Filtering Notes', section: 'Filter', text: 'Filter by color. Filter by element type dialogue. Filter by scene context.', url: 'script-notes.html#filtering' },

    // Tags & Entities
    { page: 'Tags & Entities', title: 'Tags & Entities', section: '', text: 'Production tags props costumes VFX stunts. Production breakdown tagging. Entity-based reusable items.', url: 'tags.html' },
    { page: 'Tags & Entities', title: 'Tag Categories', section: 'Categories', text: 'Cast extras stunts vehicles props special effects costumes makeup hair animals music sound set dressing greenery special equipment security additional labor VFX. 18 built-in categories. Custom categories.', url: 'tags.html#categories' },
    { page: 'Tags & Entities', title: 'Entities', section: 'Entities', text: 'Entity reusable item. Create once use many scenes. Trackable every scene appearance. Annotatable notes. Red jacket continuity.', url: 'tags.html#entities' },
    { page: 'Tags & Entities', title: 'Tagging Workflow', section: 'Workflow', text: 'Select text. Choose category props. Create or select entity. Highlighted with category color. Tag highlights toggle.', url: 'tags.html#tagging-workflow' },

    // Locations
    { page: 'Locations', title: 'Locations', section: '', text: 'Auto-extracted locations scene headings. Batch rename. Location groups. Shooting schedule.', url: 'locations.html' },
    { page: 'Locations', title: 'Location Groups', section: 'Groups', text: 'Location name. Number of scenes. Expandable list scenes. Click scene jump editor.', url: 'locations.html#location-groups' },
    { page: 'Locations', title: 'Batch Rename', section: 'Rename', text: 'Rename location entire script. Click rename button. New location name. Every scene heading updated. Coffee shop to bistro.', url: 'locations.html#batch-rename' },
    { page: 'Locations', title: 'Smart Parsing', section: 'Parsing', text: 'INT EXT prefixes normalized. Time of day morning evening continuous later. Sub-locations house kitchen.', url: 'locations.html#smart-parsing' },

    // Revision Mode
    { page: 'Revision Mode', title: 'Revision Mode & Track Changes', section: '', text: 'Mark revisions compare script versions. Inline diff green red highlighting.', url: 'revision-mode.html' },
    { page: 'Revision Mode', title: 'Revision Mode', section: 'Revision', text: 'Production tool multiple drafts. Enable production menu. Edits visually marked configurable color. Revision rounds colors.', url: 'revision-mode.html#revision-mode' },
    { page: 'Revision Mode', title: 'Track Changes', section: 'Track Changes', text: 'Compare current script checked-in version. Green highlighted new text additions. Red strikethrough deleted text. Inline diff word-level. Continue editing while viewing.', url: 'revision-mode.html#track-changes' },
    { page: 'Revision Mode', title: 'Compare Versions', section: 'Compare', text: 'View track changes since last check-in. Compare with version select specific. View menu.', url: 'revision-mode.html#compare-versions' },

    // Managing Projects
    { page: 'Managing Projects', title: 'Managing Projects', section: '', text: 'Organize screenplays scripts assets. Projects screen home base. Create project properties.', url: 'projects.html' },
    { page: 'Managing Projects', title: 'Projects Screen', section: 'Screen', text: 'Projects list title creation date modification date status. Sort by custom order title created modified. Drag drop arrange.', url: 'projects.html#projects-screen' },
    { page: 'Managing Projects', title: 'Project Properties', section: 'Properties', text: 'Genre logline synopsis author contact copyright draft language format production company director producer status target length notes. Metadata.', url: 'projects.html#project-properties' },
    { page: 'Managing Projects', title: 'Organizing Projects', section: 'Organize', text: 'Color coding visual. Pinning important top list. Drag drop custom order rearrange.', url: 'projects.html#organize' },
    { page: 'Managing Projects', title: 'Scripts Tab', section: 'Scripts', text: 'Create new scripts. Open script editor. Sort scripts title date size page count. Pin color-code delete scripts.', url: 'projects.html#scripts-tab' },
    { page: 'Managing Projects', title: 'Assets Tab', section: 'Assets', text: 'Upload files drag drop. Images documents videos. Tag assets organize. Preview images videos. Download filter search. Reference materials mood boards.', url: 'projects.html#assets-tab' },

    // Version History
    { page: 'Version History', title: 'Version History', section: '', text: 'Check in drafts compare versions restore previous work. Built-in version control Git. Time machine screenplay.', url: 'version-history.html' },
    { page: 'Version History', title: 'Checking In', section: 'Check In', text: 'File check in. Brief message describe changes. Finished scene rewrite. Snapshot saved version.', url: 'version-history.html#check-in' },
    { page: 'Version History', title: 'Viewing History', section: 'View', text: 'File version history. Versions tab project view. Message date author. Relative time hours ago.', url: 'version-history.html#view-history' },
    { page: 'Version History', title: 'Restoring a Version', section: 'Restore', text: 'Go back previous version. Find version restore button. Script updated match. New version created. Safe undo restore. Does not delete history.', url: 'version-history.html#restore' },
    { page: 'Version History', title: 'Save vs Check In', section: 'Save vs Check In', text: 'Save Cmd S disk frequently. Check in named version snapshot milestones. Finished scene end session before major changes.', url: 'version-history.html#save-vs-checkin' },

    // Import & Export
    { page: 'Import & Export', title: 'Import & Export', section: '', text: 'Final Draft Fountain PDF plain text formats. Import export save as.', url: 'import-export.html' },
    { page: 'Import & Export', title: 'Import Final Draft', section: 'Import FDX', text: 'Import Final Draft FDX. Preserves screenplay elements formatting character profiles highlighting page layout.', url: 'import-export.html#import-fdx' },
    { page: 'Import & Export', title: 'Import Fountain', section: 'Import Fountain', text: 'Import Fountain format. Open plain-text markup screenwriting. Free tools.', url: 'import-export.html#import-fountain' },
    { page: 'Import & Export', title: 'Export as PDF', section: 'Export PDF', text: 'Save as PDF Cmd P. Industry-standard formatting. Turn off note tag highlights before exporting.', url: 'import-export.html#export-pdf' },
    { page: 'Import & Export', title: 'Export as Final Draft', section: 'Export FDX', text: 'Save as Final Draft FDX file. Preserves character profiles tag categories entities.', url: 'import-export.html#export-fdx' },
    { page: 'Import & Export', title: 'Export as Fountain', section: 'Export Fountain', text: 'Save as Fountain plain-text format. Compatible any Fountain editor version control.', url: 'import-export.html#export-fountain' },

    // Themes
    { page: 'Themes', title: 'Themes', section: '', text: 'Light dark interface themes. Toggle view menu. Eye strain low-light.', url: 'themes.html' },
    { page: 'Themes', title: 'Dark Theme', section: 'Dark', text: 'Dark theme low-light environments reduced eye strain. Dark backgrounds light text. Toolbars panels menus. Editor page stays white.', url: 'themes.html#dark-theme' },
    { page: 'Themes', title: 'Light Theme', section: 'Light', text: 'Light theme default bright clean. Light grays whites. White page background.', url: 'themes.html#light-theme' },

    // Page Setup
    { page: 'Page Setup', title: 'Page Setup', section: '', text: 'Configure page dimensions margins layout. File page setup dialog.', url: 'page-setup.html' },
    { page: 'Page Setup', title: 'Settings', section: 'Settings', text: 'Page width 8.5 inches height 11 inches. US Letter. Top bottom left right margins. Header footer margins. Left margin 1.5 inches hole punches. Standard screenplay.', url: 'page-setup.html#settings' },

    // Keyboard Shortcuts
    { page: 'Keyboard Shortcuts', title: 'Keyboard Shortcuts', section: '', text: 'Quick reference all keyboard shortcuts. Speed up workflow.', url: 'keyboard-shortcuts.html' },
    { page: 'Keyboard Shortcuts', title: 'File Shortcuts', section: 'File', text: 'Cmd N new screenplay. Cmd S save. Cmd P export PDF print.', url: 'keyboard-shortcuts.html#file' },
    { page: 'Keyboard Shortcuts', title: 'Edit Shortcuts', section: 'Edit', text: 'Cmd Z undo. Shift Cmd Z redo. Cmd A select all. Cmd F find replace. Cmd G go to page.', url: 'keyboard-shortcuts.html#edit' },
    { page: 'Keyboard Shortcuts', title: 'Formatting Shortcuts', section: 'Formatting', text: 'Cmd B bold. Cmd I italic. Cmd U underline.', url: 'keyboard-shortcuts.html#formatting-shortcuts' },
    { page: 'Keyboard Shortcuts', title: 'Element Shortcuts', section: 'Elements', text: 'Cmd 1 scene heading. Cmd 2 action. Cmd 3 character. Cmd 4 dialogue. Cmd 5 parenthetical. Cmd 6 transition. Cmd 7 general. Cmd 8 shot.', url: 'keyboard-shortcuts.html#elements' },
  ];

  // DOM elements
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');

  if (!searchInput || !searchResults) return;

  // Normalize text for searching
  function normalize(str) {
    return str.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Search function
  function search(query) {
    if (!query || query.length < 2) return [];

    const normalizedQuery = normalize(query);
    const queryWords = normalizedQuery.split(' ').filter(w => w.length > 0);
    const results = [];

    for (const entry of searchIndex) {
      const searchable = normalize(entry.title + ' ' + entry.text + ' ' + entry.page + ' ' + entry.section);
      let score = 0;

      // Check if all query words appear
      let allMatch = true;
      for (const word of queryWords) {
        if (searchable.includes(word)) {
          score += 1;
          // Bonus for title match
          if (normalize(entry.title).includes(word)) score += 3;
          // Bonus for exact page name match
          if (normalize(entry.page).includes(word)) score += 2;
        } else {
          allMatch = false;
        }
      }

      // Only include if at least one word matches, prefer all-match
      if (score > 0) {
        if (allMatch) score += 5;
        results.push({ ...entry, score });
      }
    }

    // Sort by score descending, then by title
    results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    // Deduplicate by URL (keep highest score)
    const seen = new Set();
    return results.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    }).slice(0, 12);
  }

  // Highlight matches in text
  function highlightMatch(text, query) {
    if (!query) return text;
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    let result = text;
    for (const word of words) {
      const regex = new RegExp('(' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      result = result.replace(regex, '<mark>$1</mark>');
    }
    return result;
  }

  // Get a snippet containing the query
  function getSnippet(text, query, maxLen) {
    maxLen = maxLen || 120;
    const lower = text.toLowerCase();
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);

    let bestIdx = -1;
    for (const word of words) {
      const idx = lower.indexOf(word);
      if (idx !== -1) {
        bestIdx = idx;
        break;
      }
    }

    if (bestIdx === -1) return text.substring(0, maxLen);

    const start = Math.max(0, bestIdx - 30);
    const end = Math.min(text.length, start + maxLen);
    let snippet = text.substring(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet += '...';
    return snippet;
  }

  // Render results
  function renderResults(results, query) {
    if (results.length === 0) {
      searchResults.innerHTML = '<div class="search-no-results">No results found for "' +
        query.replace(/</g, '&lt;') + '"</div>';
      searchResults.classList.add('visible');
      return;
    }

    let html = '';
    for (const r of results) {
      const snippet = highlightMatch(getSnippet(r.text, query), query);
      html += '<a href="' + r.url + '" class="search-result-item">' +
        '<div class="search-result-title">' + highlightMatch(r.title, query) + '</div>' +
        '<div class="search-result-section">' + r.page + (r.section ? ' &rsaquo; ' + r.section : '') + '</div>' +
        '<div class="search-result-snippet">' + snippet + '</div>' +
        '</a>';
    }
    searchResults.innerHTML = html;
    searchResults.classList.add('visible');
  }

  // Event: input change
  let debounceTimer;
  searchInput.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    const query = this.value.trim();

    if (query.length < 2) {
      searchResults.classList.remove('visible');
      searchResults.innerHTML = '';
      return;
    }

    debounceTimer = setTimeout(function () {
      const results = search(query);
      renderResults(results, query);
    }, 150);
  });

  // Event: focus
  searchInput.addEventListener('focus', function () {
    if (this.value.trim().length >= 2) {
      const results = search(this.value.trim());
      renderResults(results, this.value.trim());
    }
  });

  // Event: click outside to close
  document.addEventListener('click', function (e) {
    if (!searchResults.contains(e.target) && e.target !== searchInput) {
      searchResults.classList.remove('visible');
    }
  });

  // Event: Escape to close
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      searchResults.classList.remove('visible');
      this.blur();
    }
    // Arrow navigation
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = searchResults.querySelectorAll('.search-result-item');
      if (items.length === 0) return;

      const current = searchResults.querySelector('.search-result-item:focus');
      let idx = Array.from(items).indexOf(current);

      if (e.key === 'ArrowDown') {
        idx = idx < items.length - 1 ? idx + 1 : 0;
      } else {
        idx = idx > 0 ? idx - 1 : items.length - 1;
      }
      items[idx].focus();
    }
    // Enter to go to first result
    if (e.key === 'Enter') {
      const first = searchResults.querySelector('.search-result-item');
      if (first) {
        window.location.href = first.getAttribute('href');
      }
    }
  });

  // Keyboard shortcut: / to focus search
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      searchInput.focus();
    }
  });

  // Mobile sidebar toggle
  window.toggleSidebar = function () {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('visible');
  };

})();
