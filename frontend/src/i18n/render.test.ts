/**
 * Real components, rendered in every language.
 *
 * The locale tests prove the files are well-formed; this proves they work where
 * they are used: a component renders without throwing, shows no raw key
 * ("dialogs:quota.title") or unfilled "{{placeholder}}", differs from English,
 * and — for Russian, Arabic and Persian — is actually in that script.
 *
 * Server-side rendering needs no DOM, so it runs in the plain node environment.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLanguage, LANGUAGES, type LanguageCode } from './index';
import WelcomeDialog from '../components/WelcomeDialog';
import QuotaExceededDialog from '../components/QuotaExceededDialog';
import DeleteEmptyProjectDialog from '../components/DeleteEmptyProjectDialog';
import DocumentOpenElsewhereDialog from '../components/DocumentOpenElsewhereDialog';

const noop = () => {};

const CASES: Array<[string, ComponentType<never>, object]> = [
  ['WelcomeDialog', WelcomeDialog as ComponentType<never>, { onChoice: noop }],
  [
    'QuotaExceededDialog',
    QuotaExceededDialog as ComponentType<never>,
    { detail: { error: 'quota_exceeded', message: 'x', current_plan: 'free', limit: 3, current: 3 }, onClose: noop },
  ],
  [
    'DeleteEmptyProjectDialog',
    DeleteEmptyProjectDialog as ComponentType<never>,
    { projectName: 'Demo', source: 'local', deletedScriptTitle: 'Pilot', versionCount: 3, folderPath: null, onKeep: noop, onDelete: async () => {} },
  ],
  [
    'DocumentOpenElsewhereDialog',
    DocumentOpenElsewhereDialog as ComponentType<never>,
    { other: { label: 'main', title: 'Pilot' }, documentTitle: 'Pilot', onSwitch: noop, onOpenAnyway: noop },
  ],
];

const SCRIPT: Partial<Record<LanguageCode, RegExp>> = {
  ru: /\p{Script=Cyrillic}/u,
  ar: /\p{Script=Arabic}/u,
  fa: /\p{Script=Arabic}/u,
};

const RAW_KEY = /\b(common|menu|editor|toolbar|format|projects|templates|story|settings|backup|collab|dialogs|tools|messages|addons):[A-Za-z0-9_.]+/;

async function render(code: LanguageCode, Component: ComponentType<never>, props: object): Promise<string> {
  await setLanguage(code);
  return renderToStaticMarkup(createElement(Component as ComponentType<object>, props));
}

afterEach(async () => {
  await setLanguage('en');
});

describe.each(CASES)('%s', (_name, Component, props) => {
  it('renders in English', async () => {
    const html = await render('en', Component, props);
    expect(html.length).toBeGreaterThan(50);
    expect(html).not.toMatch(RAW_KEY);
    expect(html).not.toContain('{{');
  });

  describe.each(LANGUAGES.filter((l) => l.code !== 'en'))('in $englishName', ({ code }) => {
    it('renders a translated, complete interface', async () => {
      const en = await render('en', Component, props);
      const html = await render(code, Component, props);
      expect(html).not.toMatch(RAW_KEY);
      expect(html).not.toContain('{{');
      expect(html).not.toContain('undefined');
      expect(html).not.toBe(en);
      const script = SCRIPT[code];
      if (script) expect(html.replace(/<[^>]+>/g, '')).toMatch(script);
    });
  });
});
