import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyAppearance } from '../utils/appearance';
import { applyDocumentLanguage, i18next, loadLanguage } from '../i18n';
import { isNavigatorUpdate, type NavigatorSnapshot } from '../services/panelProtocol';
import { getPanelContext, sendPanelAction, subscribePanel } from '../services/panelWindows';
import '../styles/panelPopout.css';

/** A read-only entry. It never mounts an editor, storage bootstrap or save hooks. */
export default function NavigatorPopout() {
  const { t } = useTranslation(['story', 'menu']);
  const [snapshot, setSnapshot] = useState<NavigatorSnapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [search, setSearch] = useState('');
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let stopped = false, session: string | undefined;
    let latestSequence = -1, appearanceRequest = 0;
    let current: NavigatorSnapshot | null = null;
    let requestedLanguage = i18next.language;
    const pending: unknown[] = [];
    const receive = (value: unknown) => {
      if (!session) { if (pending.length < 4) pending.push(value); return; }
      if (!isNavigatorUpdate(value) || value.session !== session || value.sequence <= latestSequence) return;
      const scenes = value.scenes ?? (current?.revision === value.revision ? current.scenes : undefined);
      if (!scenes || value.active >= scenes.length) return;
      latestSequence = value.sequence;
      current = { ...value, scenes };
      setSnapshot(current);
      setUnavailable(false);
      applyAppearance(value.appearance);
      if (value.language === requestedLanguage) return;
      requestedLanguage = value.language;
      const request = ++appearanceRequest;
      void loadLanguage(value.language as Parameters<typeof loadLanguage>[0]).then(async () => {
        if (stopped || request !== appearanceRequest) return;
        await i18next.changeLanguage(value.language);
        if (!stopped && request === appearanceRequest) applyDocumentLanguage(value.language as Parameters<typeof applyDocumentLanguage>[0]);
      }).catch(error => console.warn('[panels] language unavailable:', error));
    };
    const stop = subscribePanel<unknown>('panel-snapshot', receive);
    void stop.ready.then(async ready => {
      if (stopped) return;
      if (!ready) throw new Error('Panel listener unavailable');
      return getPanelContext();
    }).then(context => {
      if (stopped || !context) return;
      session = context.session;
      pending.splice(0).forEach(receive);
      return sendPanelAction({ kind: 'ready' });
    }).catch(() => { if (!stopped) setUnavailable(true); });
    return () => { stopped = true; appearanceRequest++; stop(); };
  }, []);
  useEffect(() => { activeRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [snapshot?.active]);
  const command = (action: Parameters<typeof sendPanelAction>[0]) => {
    void sendPanelAction(action).catch(() => setUnavailable(true));
  };
  const needle = search.toLocaleLowerCase();
  const scenes = snapshot?.scenes.map((scene, index) => ({ ...scene, index }))
    .filter(scene => `${scene.heading} ${scene.synopsis}`.toLocaleLowerCase().includes(needle)) ?? [];
  return (
    <main className="navigator-popout">
      <header className="navigator-popout-header">
        <h1>{snapshot?.title || t('menu:view.navigator')}</h1>
        <button type="button" onClick={() => command({ kind: 'return' })}>{t('popout.return')}</button>
      </header>
      {unavailable ? <p role="alert">{t('popout.unavailable')}</p> : !snapshot ? <p role="status">{t('popout.waiting')}</p> : <>
        <label htmlFor="popout-search">{t('navigator.filterScenes')}</label>
        <input id="popout-search" type="search" placeholder={t('navigator.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
        <nav className="navigator-popout-scenes" aria-label={t('menu:view.navigator')}>
          {scenes.length ? <ol>{scenes.map(scene => <li key={scene.index}>
            <button type="button" ref={scene.index === snapshot.active ? activeRef : undefined}
              aria-current={scene.index === snapshot.active ? 'location' : undefined}
              style={scene.color ? { borderInlineStartColor: scene.color } : undefined}
              onClick={() => command({ kind: 'navigate', revision: snapshot.revision, index: scene.index })}>
              <span>{scene.number}. {scene.heading || t('tags.untitledScene')}</span>
              {scene.synopsis && <span className="navigator-popout-synopsis">{scene.synopsis}</span>}
            </button>
          </li>)}</ol> : <p>{t(snapshot.scenes.length ? 'navigator.noMatch' : 'navigator.noScenes')}</p>}
        </nav>
      </>}
    </main>
  );
}
