import React, { useMemo } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import {
  computeOverviewStats,
  computeCharacterDialogue,
  computeGenderBreakdown,
  computeSceneBreakdown,
  computePacingData,
  computeCharacterPresence,
} from '../utils/scriptStatistics';
import { computeSceneTiming, formatRuntime, formatSceneDuration, getTimingColor } from '../utils/scriptTiming';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
  AreaChart, Area,
} from 'recharts';
import '../styles/statistics.css';

interface Props {
  editor: Editor;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

function formatTime(minutes: number): string {
  const h = Math.floor(minutes);
  const m = Math.round((minutes - h) * 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const ScriptStatistics: React.FC<Props> = ({ editor }) => {
  const { characterProfiles, pageCount, setStatisticsOpen } = useEditorStore();

  const doc = useMemo(() => editor.getJSON(), [editor]);

  const overview = useMemo(() => computeOverviewStats(doc, pageCount), [doc, pageCount]);
  const charDialogue = useMemo(() => computeCharacterDialogue(doc, characterProfiles), [doc, characterProfiles]);
  const genderStats = useMemo(() => computeGenderBreakdown(charDialogue), [charDialogue]);
  const sceneBreakdown = useMemo(() => computeSceneBreakdown(doc), [doc]);
  const pacingData = useMemo(() => computePacingData(doc), [doc]);
  const charPresence = useMemo(() => computeCharacterPresence(doc, characterProfiles), [doc, characterProfiles]);
  const timingResult = useMemo(() => computeSceneTiming(doc), [doc]);

  const sceneHeadings = useMemo(() => pacingData.map((d) => d.heading), [pacingData]);

  return (
    <div className="stats-panel">
      <div className="stats-header">
        <h2 className="stats-title">Script Statistics</h2>
        <button className="stats-close" onClick={() => setStatisticsOpen(false)} title="Close">&times;</button>
      </div>

      <div className="stats-content">
        {/* A. Overview Cards */}
        <div className="stats-overview-cards">
          <div className="stats-card">
            <div className="stats-card-value">{overview.totalPages}</div>
            <div className="stats-card-label">Pages</div>
            <div className="stats-card-sub">Est. {timingResult.totalSeconds > 0 ? formatRuntime(timingResult.totalSeconds) : formatTime(overview.estimatedRuntime)}</div>
          </div>
          <div className="stats-card">
            <div className="stats-card-value">{overview.totalScenes}</div>
            <div className="stats-card-label">Scenes</div>
            <div className="stats-card-sub">Avg {overview.averageSceneLength.toFixed(1)} pages</div>
          </div>
          <div className="stats-card">
            <div className="stats-card-value">{overview.totalCharacters}</div>
            <div className="stats-card-label">Characters</div>
            <div className="stats-card-sub">{overview.totalDialogueLines} dialogue lines</div>
          </div>
          <div className="stats-card">
            <div className="stats-card-value">{overview.totalWords.toLocaleString()}</div>
            <div className="stats-card-label">Words</div>
            <div className="stats-card-sub">{overview.totalPages > 0 ? Math.round(overview.totalWords / overview.totalPages) : 0} per page</div>
          </div>
        </div>

        {/* B. Dialogue Distribution */}
        <div className="stats-section">
          <h3 className="stats-section-title">Dialogue Distribution</h3>
          <div className="stats-dialogue-chart">
            {charDialogue.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(200, charDialogue.slice(0, 15).length * 28)}>
                <BarChart data={charDialogue.slice(0, 15)} layout="vertical" margin={{ left: 100, right: 20, top: 5, bottom: 5 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={95} />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      name === 'wordCount' ? `${value} words` : `${value.toFixed(1)}%`,
                      name === 'wordCount' ? 'Words' : '% of dialogue',
                    ]}
                    contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, fontSize: 12 }}
                  />
                  <Bar dataKey="wordCount" name="wordCount" radius={[0, 3, 3, 0]}>
                    {charDialogue.slice(0, 15).map((entry, idx) => (
                      <Cell key={entry.name} fill={entry.color || COLORS[idx % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="stats-empty">No dialogue found</div>
            )}
          </div>
          {charDialogue.length > 0 && (
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Character</th>
                  <th>Lines</th>
                  <th>Words</th>
                  <th>% Dialogue</th>
                  <th>Scenes</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {charDialogue.map((c) => (
                  <tr key={c.name}>
                    <td>
                      <span className="stats-color-dot" style={{ background: c.color || '#666' }} />
                      {c.name}
                    </td>
                    <td>{c.lineCount}</td>
                    <td>{c.wordCount}</td>
                    <td>{c.dialoguePercentage.toFixed(1)}%</td>
                    <td>{c.sceneCount}</td>
                    <td>{c.role || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* C. Gender Analysis */}
        {genderStats.length > 0 && (
          <div className="stats-section">
            <h3 className="stats-section-title">Gender Analysis</h3>
            <div className="stats-gender-row">
              <div className="stats-gender-chart">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={genderStats}
                      dataKey="wordCount"
                      nameKey="gender"
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={75}
                      paddingAngle={2}
                      label={({ gender, dialoguePercentage }) => `${gender} ${dialoguePercentage.toFixed(0)}%`}
                    >
                      {genderStats.map((_, idx) => (
                        <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => [`${value} words`, 'Dialogue']}
                      contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <table className="stats-table stats-gender-table">
                <thead>
                  <tr><th>Gender</th><th>Characters</th><th>Lines</th><th>Words</th><th>%</th></tr>
                </thead>
                <tbody>
                  {genderStats.map((g, idx) => (
                    <tr key={g.gender}>
                      <td>
                        <span className="stats-color-dot" style={{ background: COLORS[idx % COLORS.length] }} />
                        {g.gender}
                      </td>
                      <td>{g.characters}</td>
                      <td>{g.lineCount}</td>
                      <td>{g.wordCount}</td>
                      <td>{g.dialoguePercentage.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* D. Scene Breakdown — 2×2 grid */}
        <div className="stats-section">
          <h3 className="stats-section-title">Scene Breakdown</h3>
          <div className="stats-breakdown-grid">
            {/* INT vs EXT */}
            <div className="stats-mini-chart">
              <div className="stats-mini-title">Interior / Exterior</div>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'INT.', value: sceneBreakdown.intCount },
                      { name: 'EXT.', value: sceneBreakdown.extCount },
                      { name: 'INT./EXT.', value: sceneBreakdown.intExtCount },
                    ].filter((d) => d.value > 0)}
                    dataKey="value"
                    nameKey="name"
                    cx="50%" cy="50%" outerRadius={55}
                    label={({ name, value }) => `${name} ${value}`}
                  >
                    <Cell fill="#3b82f6" />
                    <Cell fill="#10b981" />
                    <Cell fill="#f59e0b" />
                  </Pie>
                  <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* DAY vs NIGHT */}
            <div className="stats-mini-chart">
              <div className="stats-mini-title">Time of Day</div>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Day', value: sceneBreakdown.dayCount },
                      { name: 'Night', value: sceneBreakdown.nightCount },
                      { name: 'Other', value: sceneBreakdown.otherTimeCount },
                    ].filter((d) => d.value > 0)}
                    dataKey="value"
                    nameKey="name"
                    cx="50%" cy="50%" outerRadius={55}
                    label={({ name, value }) => `${name} ${value}`}
                  >
                    <Cell fill="#f59e0b" />
                    <Cell fill="#6366f1" />
                    <Cell fill="#94a3b8" />
                  </Pie>
                  <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Scene Length Distribution */}
            <div className="stats-mini-chart">
              <div className="stats-mini-title">Scene Length Distribution</div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={sceneBreakdown.sceneLengthBuckets} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, fontSize: 12 }} />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Location Frequency */}
            <div className="stats-mini-chart">
              <div className="stats-mini-title">Top Locations</div>
              {sceneBreakdown.locationFrequency.length > 0 ? (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={sceneBreakdown.locationFrequency.slice(0, 8)} layout="vertical" margin={{ left: 80, right: 10, top: 5, bottom: 5 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="location" tick={{ fontSize: 9 }} width={75} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, fontSize: 12 }} />
                    <Bar dataKey="count" fill="#14b8a6" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="stats-empty">No locations found</div>
              )}
            </div>
          </div>
        </div>

        {/* E. Pacing Chart */}
        {pacingData.length > 0 && (
          <div className="stats-section">
            <h3 className="stats-section-title">Pacing — Dialogue vs Action by Scene</h3>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={pacingData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                <XAxis
                  dataKey="sceneIndex"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `S${v + 1}`}
                />
                <YAxis tick={{ fontSize: 10 }} label={{ value: 'Words', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip
                  labelFormatter={(v) => sceneHeadings[v as number] || `Scene ${(v as number) + 1}`}
                  formatter={(value: number, name: string) => [`${value} words`, name === 'dialogueWords' ? 'Dialogue' : 'Action']}
                  contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, fontSize: 12 }}
                />
                <Area type="monotone" dataKey="dialogueWords" stackId="1" stroke="#3b82f6" fill="#3b82f680" name="dialogueWords" />
                <Area type="monotone" dataKey="actionWords" stackId="1" stroke="#f59e0b" fill="#f59e0b80" name="actionWords" />
                <Legend formatter={(value) => (value === 'dialogueWords' ? 'Dialogue' : 'Action')} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* F. Character Presence Map */}
        {charPresence.length > 0 && (
          <div className="stats-section">
            <h3 className="stats-section-title">Character Presence by Scene</h3>
            <div className="stats-presence-scroll">
              <table className="stats-presence-table">
                <thead>
                  <tr>
                    <th className="stats-presence-name-col">Character</th>
                    {pacingData.map((_, i) => (
                      <th key={i} className="stats-presence-scene-col" title={sceneHeadings[i]}>
                        {i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {charPresence.slice(0, 20).map((cp) => (
                    <tr key={cp.name}>
                      <td className="stats-presence-name-col">
                        <span className="stats-color-dot" style={{ background: cp.color || '#666' }} />
                        {cp.name}
                      </td>
                      {cp.scenes.map((present, i) => (
                        <td key={i} className="stats-presence-cell">
                          {present && (
                            <span className="stats-presence-dot" style={{ background: cp.color || '#3b82f6' }} />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* G. Timing Report */}
        {timingResult.scenes.length > 0 && (
          <div className="stats-section">
            <h3 className="stats-section-title">Timing Report — Est. {formatRuntime(timingResult.totalSeconds)}</h3>
            <table className="stats-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Scene</th>
                  <th>Dialogue</th>
                  <th>Action</th>
                  <th>Est.</th>
                  <th>Cumulative</th>
                </tr>
              </thead>
              <tbody>
                {timingResult.scenes.map((st) => (
                  <tr key={st.sceneIndex}>
                    <td>{st.sceneIndex + 1}</td>
                    <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {st.heading}
                    </td>
                    <td>{formatSceneDuration(st.breakdown.dialogueSeconds)}</td>
                    <td>{formatSceneDuration(st.breakdown.actionSeconds)}</td>
                    <td style={{ color: getTimingColor(st.finalSeconds), fontWeight: 600 }}>
                      {formatSceneDuration(st.finalSeconds)}
                      {st.overrideSeconds != null && <span title="Manual override"> *</span>}
                    </td>
                    <td>{formatRuntime(st.cumulativeSeconds)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--fd-border)' }}>
                  <td></td>
                  <td>TOTAL</td>
                  <td></td>
                  <td></td>
                  <td>{formatRuntime(timingResult.totalSeconds)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScriptStatistics;
