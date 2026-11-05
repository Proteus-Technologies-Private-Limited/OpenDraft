import 'i18next';
import type { resources } from './resources';

// Every t() key is checked against the English files at compile time: a typo,
// or a key that was never added to locales/en, stops `tsc` rather than showing
// a user the raw key.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: typeof resources;
  }
}
