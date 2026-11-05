/**
 * The English resources — the source of truth every other language is checked
 * against, and the type every `t('ns:key')` call is compiled against.
 *
 * English is bundled into the app, never fetched: the desktop and mobile builds
 * have no server to ask, and a missing translation must always have English to
 * fall back on. Other languages are loaded on demand (see index.ts).
 *
 * To add a namespace: create `locales/en/<name>.json`, import it here, and add
 * it to `resources`. The other languages then need a file of the same name.
 */
import common from '../locales/en/common.json';
import menu from '../locales/en/menu.json';
import editor from '../locales/en/editor.json';
import toolbar from '../locales/en/toolbar.json';
import format from '../locales/en/format.json';
import projects from '../locales/en/projects.json';
import templates from '../locales/en/templates.json';
import story from '../locales/en/story.json';
import settings from '../locales/en/settings.json';
import backup from '../locales/en/backup.json';
import collab from '../locales/en/collab.json';
import dialogs from '../locales/en/dialogs.json';
import tools from '../locales/en/tools.json';
import messages from '../locales/en/messages.json';
import addons from '../locales/en/addons.json';

export const resources = {
  common,
  menu,
  editor,
  toolbar,
  format,
  projects,
  templates,
  story,
  settings,
  backup,
  collab,
  dialogs,
  tools,
  messages,
  addons,
} as const;

export type Namespace = keyof typeof resources;

export const NAMESPACES = Object.keys(resources) as Namespace[];
