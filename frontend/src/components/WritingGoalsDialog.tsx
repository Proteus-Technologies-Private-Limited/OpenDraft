import React, { useState } from 'react';
import { useWritingGoalsStore } from '../stores/writingGoalsStore';
import { dayKey } from '../utils/writingGoals';
import Select from './Select';

const SPRINT_LENGTHS = [5, 10, 15, 20, 25, 30, 45, 60];

/** Tools → Writing Goals & Sprints: set goals, see today, start a sprint. */
const WritingGoalsDialog: React.FC = () => {
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
    <div className="dialog-overlay" onClick={close}>
      <div
        className="dialog-box writing-goals-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="writing-goals-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
      >
        <div className="dialog-header" id="writing-goals-title">Writing Goals &amp; Sprints</div>
        <div className="dialog-body">
          <p className="writing-goals-summary">
            Today: <strong>{today}</strong> word{today === 1 ? '' : 's'} &middot; This session: <strong>{session.words}</strong> word{session.words === 1 ? '' : 's'}
            {session.pages > 0 && <>, {session.pages} page{session.pages === 1 ? '' : 's'}</>}
          </p>

          <div className="dialog-row">
            <label htmlFor="goal-daily">Daily goal (words, 0 for none)</label>
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
            <label htmlFor="goal-session">Session goal (0 for none)</label>
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
                aria-label="Session goal unit"
              >
                <option value="words">words</option>
                <option value="pages">pages</option>
              </Select>
            </div>
          </div>

          <div className="writing-goals-sprint">
            <div className="writing-goals-sprint-title">Sprint</div>
            {sprint ? (
              <div className="writing-goals-inline">
                <span>Running &mdash; {sprint.words} word{sprint.words === 1 ? '' : 's'} so far{sprint.noBackspace ? ', no backspace' : ''}.</span>
                <button className="dialog-btn" onClick={() => endSprint()}>Stop Sprint</button>
              </div>
            ) : (
              <>
                <div className="writing-goals-inline">
                  <Select value={String(minutes)} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Sprint length">
                    {SPRINT_LENGTHS.map((m) => <option key={m} value={m}>{m} minutes</option>)}
                  </Select>
                  <button className="dialog-btn dialog-btn-primary" onClick={() => { startSprint(minutes, noBackspace); close(); }}>
                    Start Sprint
                  </button>
                </div>
                <label className="writing-goals-check">
                  <input type="checkbox" checked={noBackspace} onChange={(e) => setNoBackspace(e.target.checked)} />
                  No backspace &mdash; keep going forward; Backspace and Delete do nothing until the sprint ends
                </label>
              </>
            )}
          </div>

          <p className="writing-goals-note">
            Words written are counted from your scripts a few seconds after you stop typing, and kept only on this
            device. Opening a script, imports and large pastes are not counted.
          </p>
        </div>
        <div className="dialog-actions">
          <button className="dialog-primary" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
};

export default WritingGoalsDialog;
