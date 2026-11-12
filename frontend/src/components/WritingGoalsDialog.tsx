import React, { useState } from 'react';
import { ModalOverlay } from './ModalOverlay';
import { Trans, useTranslation } from 'react-i18next';
import { useWritingGoalsStore } from '../stores/writingGoalsStore';
import { dayKey } from '../utils/writingGoals';
import Select from './Select';

const SPRINT_LENGTHS = [5, 10, 15, 20, 25, 30, 45, 60];

/** Tools → Writing Goals & Sprints: set goals, see today, start a sprint. */
const WritingGoalsDialog: React.FC = () => {
  const { t } = useTranslation(['tools', 'common']);
  const goals = useWritingGoalsStore((s) => s.goals);
  const setGoals = useWritingGoalsStore((s) => s.setGoals);
  const history = useWritingGoalsStore((s) => s.history);
  const session = useWritingGoalsStore((s) => s.session);
  const sprint = useWritingGoalsStore((s) => s.sprint);
  const startSprint = useWritingGoalsStore((s) => s.startSprint);
  const endSprint = useWritingGoalsStore((s) => s.endSprint);
  const setOpen = useWritingGoalsStore((s) => s.setDialogOpen);
  const [minutes, setMinutes] = useState(15);
  const [noBackspace, setNoBackspace] = useState(false);
  const today = history[dayKey(new Date())]?.words ?? 0;
  const close = () => setOpen(false);
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

  return (
    <ModalOverlay className="dialog-overlay" onClick={close}>
      <div
        className="dialog-box writing-goals-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="writing-goals-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
      >
        <div className="dialog-header" id="writing-goals-title">{t('goals.title')}</div>
        <div className="dialog-body">
          <p className="writing-goals-summary">
            <Trans ns="tools" i18nKey="goals.summary.today" count={today} components={{ strong: <strong /> }} /> &middot; <Trans ns="tools" i18nKey="goals.summary.session" count={session.words} components={{ strong: <strong /> }} />
            {session.pages > 0 && <>, {t('goals.summary.pages', { count: session.pages })}</>}
          </p>

          <div className="dialog-row">
            <label htmlFor="goal-daily">{t('goals.daily')}</label>
            <input
              id="goal-daily"
              type="number"
              min={0}
              step={50}
              value={goals.dailyWords}
              onChange={(e) => setGoals({ dailyWords: num(e.target.value) })}
            />
          </div>

          <div className="dialog-row writing-goals-row">
            <label htmlFor="goal-session">{t('goals.session')}</label>
            <div className="writing-goals-inline">
              <input
                id="goal-session"
                type="number"
                min={0}
                step={goals.sessionUnit === 'pages' ? 1 : 50}
                value={goals.sessionTarget}
                onChange={(e) => setGoals({ sessionTarget: num(e.target.value) })}
              />
              <Select
                value={goals.sessionUnit}
                onChange={(e) => setGoals({ sessionUnit: e.target.value === 'pages' ? 'pages' : 'words' })}
                aria-label={t('goals.sessionUnit')}
              >
                <option value="words">{t('goals.words')}</option>
                <option value="pages">{t('goals.pages')}</option>
              </Select>
            </div>
          </div>

          <div className="writing-goals-sprint">
            <div className="writing-goals-sprint-title">{t('goals.sprint.title')}</div>
            {sprint ? (
              <div className="writing-goals-inline">
                <span>{sprint.noBackspace ? t('goals.sprint.runningNoBackspace', { count: sprint.words }) : t('goals.sprint.running', { count: sprint.words })}</span>
                <button className="dialog-btn" onClick={() => endSprint()}>{t('goals.sprint.stop')}</button>
              </div>
            ) : (
              <>
                <div className="writing-goals-inline">
                  <Select value={String(minutes)} onChange={(e) => setMinutes(Number(e.target.value))} aria-label={t('goals.sprint.length')}>
                    {SPRINT_LENGTHS.map((m) => <option key={m} value={m}>{t('goals.sprint.minutes', { count: m })}</option>)}
                  </Select>
                  <button className="dialog-btn dialog-btn-primary" onClick={() => { startSprint(minutes, noBackspace); close(); }}>
                    {t('goals.sprint.start')}
                  </button>
                </div>
                <label className="writing-goals-check">
                  <input type="checkbox" checked={noBackspace} onChange={(e) => setNoBackspace(e.target.checked)} />
                  {t('goals.sprint.noBackspace')}
                </label>
              </>
            )}
          </div>

          <p className="writing-goals-note">
            {t('goals.note')}
          </p>
        </div>
        <div className="dialog-actions">
          <button className="dialog-primary" onClick={close}>{t('common:done')}</button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default WritingGoalsDialog;
