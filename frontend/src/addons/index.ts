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
 * and in OpenDraft-Pro (which reuses core's App) alike.
 */
import { pluginRegistry, type OpenDraftPlugin } from '../plugins/registry';
import aiAssistant from './ai-assistant';

/** Every add-on that ships with the core. */
export const CORE_ADDONS: readonly OpenDraftPlugin[] = [
  aiAssistant,
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

registerCoreAddOns();
