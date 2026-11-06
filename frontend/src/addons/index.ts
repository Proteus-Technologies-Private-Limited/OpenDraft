/**
 * Core add-ons: the optional features that ship with OpenDraft.
 *
 * An add-on is an ordinary plugin (plugins/registry `OpenDraftPlugin`) with
 * `optIn: true`. It lives in its own folder here — `addons/<id>/index.ts`,
 * default-exporting the plugin — and is listed in CORE_ADDONS below. It
 * reaches the app only through the registry's extension points (menu items,
 * panels, editor extensions, importers, exporters, reports, grammar
 * providers), so the registry can withhold all of it until the writer turns
 * it on in Settings → Add-ons.
 *
 * Rules (enforced by addons/boundary.test.ts):
 * - Every entry is `optIn`, with a `description` and a `privacy` statement.
 * - Nothing outside `src/addons/` imports from it except App.tsx, which
 *   imports this file once. An add-on that is wired into the editor, toolbar
 *   or menus directly cannot be turned off — that is exactly what this
 *   folder exists to prevent.
 *
 * App.tsx imports this module, so the add-ons are registered in the core app
 * and in OpenDraft-Pro (which reuses core's App) alike. They are registered
 * once i18next has started, not on import: an add-on's description and privacy
 * statement are translated text, which reads as empty until then, and the
 * check below would refuse every add-on. App.tsx is imported before main.tsx
 * awaits initI18n(), so registering on import did exactly that.
 */
import { i18next } from '../i18n';
import { pluginRegistry, type OpenDraftPlugin } from '../plugins/registry';
import aiAssistant from './ai-assistant';
import dictation from './dictation';

/** Every add-on that ships with the core. */
export const CORE_ADDONS: readonly OpenDraftPlugin[] = [
  aiAssistant,
  dictation,
];

/** Why an add-on cannot be registered, or null when it can. */
export function addOnProblem(plugin: OpenDraftPlugin): string | null {
  if (!plugin.optIn) return 'it is not marked optIn, so it could not be turned off';
  if (!plugin.description?.trim()) return 'it has no description for Settings → Add-ons';
  if (!plugin.privacy?.trim()) return 'it does not say what, if anything, leaves the device';
  return null;
}

let registered = false;

/** Register the core add-ons. Safe to call more than once. */
export function registerCoreAddOns(addOns: readonly OpenDraftPlugin[] = CORE_ADDONS): void {
  if (registered && addOns === CORE_ADDONS) return;
  for (const plugin of addOns) {
    const problem = addOnProblem(plugin);
    if (problem) {
      // Never register a malformed add-on: one that is not opt-in would be on
      // for every writer without their choice.
      console.error(`[add-ons] not registering "${plugin.id}": ${problem}`);
      continue;
    }
    try {
      pluginRegistry.register(plugin);
    } catch (err) {
      console.error(`[add-ons] "${plugin.id}" could not be registered`, err);
    }
  }
  if (addOns === CORE_ADDONS) registered = true;
}

type I18nEvents = Pick<typeof i18next, 'isInitialized' | 'on' | 'off'>;

/** Run `fn` now if i18next has started, otherwise as soon as it has. */
export function whenTranslationsReady(i18n: I18nEvents, fn: () => void): void {
  if (i18n.isInitialized) {
    fn();
    return;
  }
  const ready = () => {
    i18n.off('initialized', ready);
    try {
      fn();
    } catch (err) {
      console.error('[add-ons] could not register the core add-ons', err);
    }
  };
  i18n.on('initialized', ready);
}

whenTranslationsReady(i18next, () => registerCoreAddOns());
