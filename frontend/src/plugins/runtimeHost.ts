/**
 * The modules a runtime plugin shares with the app (plugin API version 1).
 *
 * A runtime plugin is a script the web app loads at start-up from the server's
 * plugins folder (backend/app/frontend_plugins.py, loaded by
 * runtimeLoader.ts). It must not carry its own React, ProseMirror or i18next:
 * two copies break hooks, editor state and translations in ways that are hard
 * to trace. So its build leaves these imports out (as `external`s) and reads
 * them from globals the app sets here, one per module:
 *
 *   import { useState } from 'react'   →   __ODP_react.useState
 *
 * `globalNameFor(id)` is the naming rule a plugin's build uses for its
 * `output.globals` (OD-Sidekick: vite.runtime.config.ts).
 *
 * This list is the runtime plugin API. Adding a module is compatible; removing
 * one, or a breaking change to a module's exports, needs a new
 * RUNTIME_PLUGIN_API_VERSION (also in the backend, which refuses plugins that
 * ask for a newer one). Everything else a plugin needs it bundles itself —
 * react-icons, say — and anything from core outside this list is not
 * available at run time (build-time plugins, vite.plugins.ts, may use more).
 */
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as JsxRuntime from 'react/jsx-runtime';
import * as TiptapCore from '@tiptap/core';
import * as TiptapReact from '@tiptap/react';
import * as PmState from '@tiptap/pm/state';
import * as PmModel from '@tiptap/pm/model';
import * as PmView from '@tiptap/pm/view';
import * as PmTransform from '@tiptap/pm/transform';
import * as I18next from 'i18next';
import * as ReactI18next from 'react-i18next';
import * as Registry from './registry';
import * as CoreI18n from '../i18n';
import * as Toast from '../components/Toast';

export const RUNTIME_PLUGIN_API_VERSION = 1;

/** Each shared module, under the specifier a plugin imports it by. */
export const SHARED_MODULES: Readonly<Record<string, object>> = {
  react: React,
  'react/jsx-runtime': JsxRuntime,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  '@tiptap/core': TiptapCore,
  '@tiptap/react': TiptapReact,
  '@tiptap/pm/state': PmState,
  '@tiptap/pm/model': PmModel,
  '@tiptap/pm/view': PmView,
  '@tiptap/pm/transform': PmTransform,
  i18next: I18next,
  'react-i18next': ReactI18next,
  '@core/plugins/registry': Registry,
  '@core/i18n': CoreI18n,
  '@core/components/Toast': Toast,
};

/** The global a shared module is published under: `@tiptap/pm/state` → `__ODP__tiptap_pm_state`. */
export function globalNameFor(specifier: string): string {
  return `__ODP_${specifier.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

let installed = false;

/** Publish the shared modules. Idempotent; call before loading any runtime plugin. */
export function installRuntimeHost(): void {
  if (installed) return;
  const target = globalThis as Record<string, unknown>;
  for (const [specifier, namespace] of Object.entries(SHARED_MODULES)) {
    // A plain object marked as an ES module, so a bundler's default-import
    // interop reads `default` (React's or i18next's) rather than wrapping it.
    target[globalNameFor(specifier)] = Object.freeze({ __esModule: true, ...namespace });
  }
  target.__OPENDRAFT_PLUGIN_HOST__ = Object.freeze({
    apiVersion: RUNTIME_PLUGIN_API_VERSION,
    modules: Object.keys(SHARED_MODULES),
  });
  installed = true;
}
