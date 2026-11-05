import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../i18n/format';
import { useWritingGoalsStore } from '../stores/writingGoalsStore';
import { dayKey, heatmap, lastSevenDays, writingStreak } from '../utils/writingGoals';

const WEEKS = 18;

/** Script Statistics: words written per day over the last few months, kept on this device. */
const WritingHeatmap: React.FC = () => {
  const { t } = useTranslation('tools');
  const history = useWritingGoalsStore((s) => s.history);
  const dailyGoal = useWritingGoalsStore((s) => s.goals.dailyWords);
  const setOpen = useWritingGoalsStore((s) => s.setDialogOpen);
  const today = new Date();
  const todayKey = dayKey(today);
  const cols = heatmap(history, today, WEEKS, dailyGoal);
  const week = lastSevenDays(history, today);
  const streak = writingStreak(history, today);

  return (
    <div className="stats-section">
      <h3 className="stats-section-title">{t('heatmap.title')}</h3>
      <p className="writing-heatmap-summary">
        {t('heatmap.summary', { today: history[todayKey]?.words ?? 0, week, count: streak })}
        {' '}<button className="writing-heatmap-goals" onClick={() => setOpen(true)}>{t('heatmap.goalsAndSprints')}</button>
      </p>
      <div className="writing-heatmap" role="img" aria-label={t('heatmap.ariaLabel', { weeks: WEEKS })}>
        {cols.map((col, i) => (
          <div key={i} className="writing-heatmap-col">
            {col.map((c) => (
              <div
                key={c.key}
                className={`writing-heatmap-cell level-${c.level}${c.future ? ' is-future' : ''}${c.key === todayKey ? ' is-today' : ''}`}
                title={c.future ? undefined : t('heatmap.cellTitle', { date: formatDate(c.date, { weekday: 'short', month: 'short', day: 'numeric' }), count: c.words })}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="writing-heatmap-legend">
        {t('heatmap.less')} {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`writing-heatmap-cell level-${l}`} />)} {t('heatmap.more')}
        <span className="writing-heatmap-private">{t('heatmap.private')}</span>
      </div>
    </div>
  );
};

export default WritingHeatmap;
