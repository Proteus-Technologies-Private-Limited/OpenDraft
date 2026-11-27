/** The status-bar count of pending tasks; nothing at all when there are none. */
import { useTranslation } from 'react-i18next';
import { FaTasks } from 'react-icons/fa';
import { useSidekickData } from '../data';
import { isPending, PLUGIN_ID } from '../model';
import { openPanel } from '../actions';
import './sidekick.css';

export function StatusBarItem() {
  const { t } = useTranslation(PLUGIN_ID);
  const data = useSidekickData();
  const pending = data.tasks.filter(isPending).length;
  if (pending === 0) return null;
  const closed = data.tasks.length - pending;
  return (
    <button type="button" className="sk-status" onClick={openPanel} title={t('statusBar.title', { pending, closed })}>
      <FaTasks aria-hidden /> {t('statusBar.label', { count: pending })}
    </button>
  );
}
