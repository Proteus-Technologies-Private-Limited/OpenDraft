/**
 * The Sidekick's words, in its own i18next namespace (the plugin id), so they
 * can never collide with the app's. Registered with core's
 * `addPluginResources`; a language without a bundle shows English.
 *
 * Add a language by adding a bundle with the same keys.
 */
import { addPluginResources } from '../../i18n';
import { BUILT_IN_TYPES, PLUGIN_ID } from './model';

const types = Object.fromEntries(BUILT_IN_TYPES.map((type) => [type.id, { label: type.label, hint: type.hint }]));

// i18n-ignore-start: English translation resource for Sidekick
export const en = {
  plugin: {
    name: 'Sidekick',
    description: 'Keep to-dos and material held for later inside the script.',
  },
  menu: {
    sidekick: 'Sidekick',
    open: 'Show Sidekick',
    addTodo: 'Add to To Do',
    addHold: 'Add to Hold for Later',
    addTo: 'Add Task To',
  },
  panel: {
    title: 'Sidekick',
    noScript: 'Open a script to keep tasks with it.',
    dropTitle: 'Add a task',
    dropHelp: 'Select text in the script, then drag it onto a type or tap one.',
    dropHelpTouch: 'Select text in the script, then tap a type to file it.',
    dropHelpEmpty: 'Choose an available type, or select text to use any type with a script link.',
    dropHere: 'Drop it on a type to file it.',
    track: 'To track',
    keep: 'Keep for later',
    search: 'Search tasks',
    filter: 'Show',
    filterPending: 'Pending',
    filterClosed: 'Done & used',
    filterAll: 'All',
    empty: 'No tasks yet. Choose a task type to get started.',
    emptyFiltered: 'No tasks match.',
    other: 'Other',
    count_one: '{{count}} task',
    count_other: '{{count}} tasks',
    summary: '{{pending}} pending · {{closed}} done',
    typesTitle: 'Task types',
    typesHelp: 'Set how new tasks capture text and link to the script.',
    editType: 'Edit',
    editTypeNamed: 'Edit {{name}} behavior',
    scriptLink: 'Script link',
    selectionRequired: 'Selection required',
    selectionOptional: 'Selection or cursor',
    noScriptLink: 'No script link',
    selectedText: 'Selected text',
    copyText: 'Copy text to Sidekick',
    moveText: 'Move text out of the script',
    show: 'Show',
    hide: 'Hide',
    newType: 'New type',
    newTypeName: 'Name',
    newTypeKind: 'Kind',
    newTypeColor: 'Colour',
    add: 'Add',
    deleteType: 'Delete type',
    undoDelete: 'Task deleted.',
    undo: 'Undo',
    dismiss: 'Dismiss',
  },
  task: {
    subject: 'Subject',
    note: 'Note',
    notePlaceholder: 'Your note…',
    addNote: 'Add note',
    status: 'Status',
    type: 'Type',
    goTo: 'Go to',
    goToTitle: 'Find this in the script',
    goToCursorTitle: 'Go to the saved cursor position',
    insert: 'Insert',
    insertTitle: 'Insert this below the element the cursor is in, with its formatting',
    insertMovedTitle: 'Use Go to first to restore the text in its original spot',
    copy: 'Copy',
    copied: 'Copied',
    delete: 'Delete',
    more: 'Show all',
    less: 'Show less',
    notFound: 'Could not find the saved location in the script.',
    locationOnly: 'The text has changed. Showing the saved location.',
    from: 'From {{scene}}',
    noScene: 'Before the first scene',
    created: 'Filed {{date}}',
    markDone: 'Mark done',
    markOpen: 'Mark not done',
    filed: 'Filed under {{type}}.',
  },
  status: {
    open: 'Open',
    'in-progress': 'In progress',
    done: 'Done',
    kept: 'Kept',
    used: 'Used',
  },
  kind: {
    track: 'To track',
    keep: 'Keep for later',
  },
  statusBar: {
    label: '{{count}} pending',
    title: 'Sidekick: {{pending}} pending, {{closed}} done. Click to show.',
  },
  errors: {
    noSelection: 'Select some text in the script first.',
    noEditor: 'Open a script first.',
    noType: 'This task type is unavailable.',
    moveFailed: 'The selected text could not be moved. Select it again in an editable script.',
    moveDrop: 'To move text, drag a selection from this script.',
    saveFailed: 'The Sidekick could not save that: {{message}}',
    insertFailed: 'This excerpt cannot be inserted into this script: {{message}}',
    copyFailed: 'Could not copy: {{message}}',
    dropFailed: 'Nothing from that drop could be filed.',
  },
  report: {
    label: 'Sidekick tasks',
    description: 'Every to-do and kept excerpt, with its status and scene.',
    title: 'Sidekick tasks — {{title}}',
    summary: '{{pending}} pending, {{closed}} done or used, {{total}} in all',
    type: 'Type',
    kind: 'Kind',
    subject: 'Subject',
    status: 'Status',
    scene: 'Scene',
    excerpt: 'Excerpt',
    note: 'Note',
    filed: 'Filed',
  },
  export: {
    label: 'Sidekick Tasks (.md)',
  },
  types,
};
// i18n-ignore-end

export function registerTranslations(): void {
  addPluginResources(PLUGIN_ID, { en });
}
