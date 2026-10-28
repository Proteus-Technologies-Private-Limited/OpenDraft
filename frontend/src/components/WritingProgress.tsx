import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useWritingGoalsStore } from '../stores/writingGoalsStore';
import { dayKey, goalFraction } from '../utils/writingGoals';

const R = 6;
const CIRCUMFERENCE = 2 * Math.PI * R;

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Status bar: progress towards the daily goal (or the session goal when there
 * is no daily one) as a ring, or the sprint countdown while a sprint runs.
 * Click for Writing Goals & Sprints.
 */
const WritingProgress: React.FC = () => {
  const goals = useWritingGoalsStore((s) => s.goals);
  const history = useWritingGoalsStore((s) => s.history);
  const session = useWritingGoalsStore((s) => s.session);
  const sprint = useWritingGoalsStore((s) => s.sprint);
  const setOpen = useWritingGoalsStore((s) => s.setDialogOpen);
  const pageCount = useEditorStore((s) => s.pageCount);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!sprint) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sprint]);

  const today = history[dayKey(new Date())]?.words ?? 0;
  let label: string;
  let fraction: number;
  let title: string;
  if (sprint) {
    // `now` ticks once a second and may still be from before the sprint began.
    const left = Math.min(sprint.durationMs, Math.max(0, sprint.endsAt - now));
    fraction = goalFraction(sprint.durationMs - left, sprint.durationMs);
    label = `${clock(left)} · ${sprint.words}w`;
    title = `Sprint: ${sprint.words} words so far${sprint.noBackspace ? ', no backspace' : ''}`;
  } else if (goals.dailyWords > 0) {
    fraction = goalFraction(today, goals.dailyWords);
    label = `${today} / ${goals.dailyWords}`;
    title = `${today} of ${goals.dailyWords} words today`;
  } else if (goals.sessionTarget > 0) {
    const done = goals.sessionUnit === 'pages' ? session.pages : session.words;
    fraction = goalFraction(done, goals.sessionTarget);
    label = `${done} / ${goals.sessionTarget}${goals.sessionUnit === 'pages' ? 'p' : ''}`;
    title = `${done} of ${goals.sessionTarget} ${goals.sessionUnit} this session (script is ${pageCount} pages)`;
  } else {
    fraction = 0;
    label = `${today} today`;
    title = `${today} words written today — set a goal`;
  }

  return (
    <button
      type="button"
      className={`status-item status-goals${sprint ? ' is-sprint' : ''}${fraction >= 1 && !sprint ? ' is-met' : ''}`}
      onClick={() => setOpen(true)}
      title={`${title} — Writing Goals & Sprints`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r={R} className="status-goals-track" />
        <circle
          cx="8" cy="8" r={R} className="status-goals-fill"
          strokeDasharray={`${fraction * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          transform="rotate(-90 8 8)"
        />
      </svg>
      <span>{label}</span>
    </button>
  );
};

export default WritingProgress;
