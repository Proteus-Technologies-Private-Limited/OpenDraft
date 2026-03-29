import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';

interface SceneNavigatorProps {
  editor: Editor | null;
  scrollContainer?: HTMLDivElement | null;
}

type NavTab = 'scenes' | 'locations';

// ── Scene heading parser ────────────────────────────────────────────────

interface ParsedHeading {
  preamble: string;
  prefix: string;
  location: string;
  timeOfDay: string;
  raw: string;
}

const TIME_WORDS = 'DAY|NIGHT|DAWN|DUSK|MORNING|AFTERNOON|EVENING|SUNSET|SUNRISE|LATER|CONTINUOUS|SAME TIME|MOMENTS LATER|SAME|MAGIC HOUR';
const PREFIX_RE = /(INT\.?\/?EXT\.?|EXT\.?\/?INT\.?|INT\.?|EXT\.?|I\/E\.?)\s+/i;

function normalisePrefix(raw: string): string {
  let p = raw.toUpperCase();
  if (p === 'INT/EXT' || p === 'INT/EXT.' || p === 'EXT/INT' || p === 'EXT/INT.' || p === 'I/E' || p === 'I/E.') return 'INT./EXT.';
  if (!p.endsWith('.')) p += '.';
  return p;
}

function parseHeading(raw: string): ParsedHeading {
  let rest = raw.trim();
  let preamble = '';
  let prefix = '';
  let timeOfDay = '';

  const prefixMatch = rest.match(PREFIX_RE);
  if (prefixMatch && prefixMatch.index !== undefined) {
    preamble = rest.slice(0, prefixMatch.index);
    prefix = normalisePrefix(prefixMatch[1]);
    rest = rest.slice(prefixMatch.index + prefixMatch[0].length);
  }

  const dashTime = rest.match(new RegExp(`\\s+-\\s+(${TIME_WORDS})\\.?$`, 'i'));
  if (dashTime) {
    timeOfDay = dashTime[1].toUpperCase();
    rest = rest.slice(0, -dashTime[0].length);
  } else {
    const dotTime = rest.match(new RegExp(`\\.\\s*(${TIME_WORDS})\\.?$`, 'i'));
    if (dotTime) {
      timeOfDay = dotTime[1].toUpperCase();
      rest = rest.slice(0, -dotTime[0].length);
    }
  }

  let location = rest.replace(/^[\s.]+|[\s.]+$/g, '');

  return { preamble, prefix, location, timeOfDay, raw };
}

// ── Location grouping ───────────────────────────────────────────────────

interface LocationGroup {
  name: string;
  sceneIndices: number[];
  headings: string[];
  prefixes: string[];
  times: string[];
  preambles: string[];
}

function groupByLocation(
  scenes: Array<{ heading: string }>,
): LocationGroup[] {
  const map = new Map<string, LocationGroup>();

  scenes.forEach((scene, index) => {
    const parsed = parseHeading(scene.heading);
    const key = parsed.location.toUpperCase();
    if (!key) return;

    let group = map.get(key);
    if (!group) {
      group = { name: parsed.location, sceneIndices: [], headings: [], prefixes: [], times: [], preambles: [] };
      map.set(key, group);
    }
    group.sceneIndices.push(index);
    group.headings.push(scene.heading);
    group.prefixes.push(parsed.prefix);
    group.times.push(parsed.timeOfDay);
    group.preambles.push(parsed.preamble.replace(/[\s.]+$/, ''));
  });

  return Array.from(map.values());
}

// ── Main component ──────────────────────────────────────────────────────

const SceneNavigator: React.FC<SceneNavigatorProps> = ({ editor, scrollContainer }) => {
  const { scenes, navigatorOpen } = useEditorStore();
  const [activeTab, setActiveTab] = useState<NavTab>('scenes');
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null);
  const [renamingLocation, setRenamingLocation] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const locations = useMemo(() => groupByLocation(scenes), [scenes]);

  useEffect(() => {
    if (renamingLocation && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingLocation]);

  // ── Navigate to a scene by index ──

  const goToScene = useCallback(
    (sceneIndex: number) => {
      if (!editor) return;
      const { doc } = editor.state;
      let currentScene = -1;
      let targetPos = 0;

      doc.descendants((node, pos) => {
        if (node.type.name === 'sceneHeading') {
          currentScene++;
          if (currentScene === sceneIndex) {
            targetPos = pos;
            return false;
          }
        }
        return true;
      });

      editor.chain().focus().setTextSelection(targetPos + 1).run();

      requestAnimationFrame(() => {
        const coords = editor.view.coordsAtPos(targetPos + 1);
        if (scrollContainer) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const scrollTo =
            scrollContainer.scrollTop + (coords.top - containerRect.top) - 60;
          scrollContainer.scrollTo({ top: scrollTo, behavior: 'smooth' });
        }
      });
    },
    [editor, scrollContainer],
  );

  // ── Batch rename a location across all scene headings ──

  const handleRenameSubmit = useCallback(() => {
    if (!editor || !renamingLocation || !renameValue.trim()) {
      setRenamingLocation(null);
      return;
    }

    const oldName = renamingLocation;
    const newName = renameValue.trim();
    if (oldName === newName) {
      setRenamingLocation(null);
      return;
    }

    const { doc, schema, tr } = editor.state;
    const sceneHeadingType = schema.nodes.sceneHeading;
    if (!sceneHeadingType) {
      setRenamingLocation(null);
      return;
    }

    doc.descendants((node, pos) => {
      if (node.type.name !== 'sceneHeading') return true;
      const heading = node.textContent;
      const parsed = parseHeading(heading);
      if (parsed.location.toUpperCase() !== oldName.toUpperCase()) return true;

      let newHeading = parsed.preamble;
      if (parsed.prefix) newHeading += parsed.prefix + ' ';
      newHeading += newName;
      if (parsed.timeOfDay) {
        const usesDot = /\.\s*\w+\.?\s*$/.test(heading) && !/\s-\s/.test(heading);
        newHeading += usesDot ? '. ' + parsed.timeOfDay + '.' : ' - ' + parsed.timeOfDay;
      }

      const from = pos + 1;
      const to = from + heading.length;
      tr.insertText(newHeading, from, to);
      return true;
    });

    if (tr.steps.length > 0) {
      editor.view.dispatch(tr);
    }

    setRenamingLocation(null);
    setExpandedLocation(newName.toUpperCase());
  }, [editor, renamingLocation, renameValue]);

  if (!navigatorOpen) return null;

  return (
    <div className="scene-navigator">
      {/* Tab bar */}
      <div className="navigator-tabs">
        <button
          className={`navigator-tab${activeTab === 'scenes' ? ' active' : ''}`}
          onClick={() => setActiveTab('scenes')}
        >
          Scenes
        </button>
        <button
          className={`navigator-tab${activeTab === 'locations' ? ' active' : ''}`}
          onClick={() => setActiveTab('locations')}
        >
          Locations
        </button>
      </div>

      {/* ── Scenes tab ───────────────────────────────────────────────── */}
      {activeTab === 'scenes' && (
        <>
          <div className="navigator-header">
            <span className="navigator-title">Scenes</span>
            <span className="scene-count">{scenes.length}</span>
          </div>
          <div className="navigator-list">
            {scenes.length === 0 ? (
              <div className="navigator-empty">
                No scenes yet. Start writing a scene heading (INT. or EXT.)
              </div>
            ) : (
              scenes.map((scene, index) => (
                <div
                  key={scene.id}
                  className="navigator-scene"
                  onClick={() => goToScene(index)}
                >
                  <div
                    className="scene-color-dot"
                    style={{ backgroundColor: scene.color || '#4a9eff' }}
                  />
                  <div className="scene-info">
                    <div className="scene-heading-text">
                      {scene.sceneNumber != null && (
                        <span className="scene-number">{scene.sceneNumber}. </span>
                      )}
                      {scene.heading}
                    </div>
                    {scene.synopsis && (
                      <div className="scene-synopsis">{scene.synopsis}</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ── Locations tab ────────────────────────────────────────────── */}
      {activeTab === 'locations' && (
        <>
          <div className="navigator-header">
            <span className="navigator-title">Locations</span>
            <span className="scene-count">{locations.length}</span>
          </div>
          <div className="navigator-list">
            {locations.length === 0 ? (
              <div className="navigator-empty">
                No locations yet. Scene headings like
                &ldquo;INT. COFFEE SHOP - DAY&rdquo; will appear here.
              </div>
            ) : (
              locations.map((loc) => {
                const key = loc.name.toUpperCase();
                const isExpanded = expandedLocation === key;
                const isRenaming = renamingLocation === key;

                return (
                  <div key={key} className="location-group">
                    <div
                      className="location-header"
                      onClick={() =>
                        setExpandedLocation(isExpanded ? null : key)
                      }
                    >
                      <span className="location-name">{loc.name}</span>
                      <span className="location-scene-count">
                        {loc.sceneIndices.length}
                      </span>
                      <span
                        className={`location-chevron${isExpanded ? ' expanded' : ''}`}
                      >
                        &#9662;
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="location-detail">
                        {isRenaming ? (
                          <div className="location-rename-row">
                            <input
                              ref={renameInputRef}
                              className="location-rename-input"
                              value={renameValue}
                              onChange={(e) =>
                                setRenameValue(e.target.value.toUpperCase())
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRenameSubmit();
                                if (e.key === 'Escape')
                                  setRenamingLocation(null);
                              }}
                              onBlur={handleRenameSubmit}
                            />
                          </div>
                        ) : (
                          <button
                            className="location-rename-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingLocation(key);
                              setRenameValue(loc.name);
                            }}
                          >
                            Rename Location
                          </button>
                        )}

                        <div className="location-scenes">
                          {loc.sceneIndices.map((sceneIdx, i) => (
                            <div
                              key={sceneIdx}
                              className="location-scene-item"
                              onClick={(e) => {
                                e.stopPropagation();
                                goToScene(sceneIdx);
                              }}
                            >
                              <span className="location-scene-num">
                                {sceneIdx + 1}.
                              </span>
                              <div className="location-scene-info">
                                <div className="location-scene-top">
                                  <span className="location-scene-prefix">
                                    {loc.prefixes[i]}
                                  </span>
                                  {loc.times[i] && (
                                    <span className="location-scene-time">
                                      {loc.times[i]}
                                    </span>
                                  )}
                                </div>
                                {loc.preambles[i] && (
                                  <div className="location-scene-preamble">
                                    {loc.preambles[i]}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default SceneNavigator;
