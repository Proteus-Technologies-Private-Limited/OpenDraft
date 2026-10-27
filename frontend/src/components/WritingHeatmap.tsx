import React from 'react';
import { useWritingGoalsStore } from '../stores/writingGoalsStore';
import { dayKey, heatmap, lastSevenDays, writingStreak } from '../utils/writingGoals';

const WEEKS = 18;

/** Script Statistics: words written per day over the last few months, kept on this device. */
const WritingHeatmap: React.FC = () => {
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
      <h3 className="stats-section-title">Words Written</h3>
      <p className="writing-heatmap-summary">
        Today {history[todayKey]?.words ?? 0} &middot; Last 7 days {week} &middot; Streak {streak} day{streak === 1 ? '' : 's'}
        {' '}<button className="writing-heatmap-goals" onClick={() => setOpen(true)}>Goals &amp; sprints&hellip;</button>
      </p>
      <div className="writing-heatmap" role="img" aria-label={`Words written per day over the last ${WEEKS} weeks`}>
        {cols.map((col, i) => (
          <div key={i} className="writing-heatmap-col">
            {col.map((c) => (
              <div
                key={c.key}
                className={`writing-heatmap-cell level-${c.level}${c.future ? ' is-future' : ''}${c.key === todayKey ? ' is-today' : ''}`}
                title={c.future ? undefined : `${c.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${c.words} words`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="writing-heatmap-legend">
        Less {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`writing-heatmap-cell level-${l}`} />)} More
        <span className="writing-heatmap-private">Counted on this device only.</span>
      </div>
    </div>
  );
};

export default WritingHeatmap;
