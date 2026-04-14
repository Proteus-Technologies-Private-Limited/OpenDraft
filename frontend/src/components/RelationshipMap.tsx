/**
 * Character Relationship Map — Visual Graph
 *
 * SVG-based force-directed graph showing character relationships.
 * Characters are nodes sized by importance (dialogue count / role).
 * Edges show relationship type and dynamic.
 *
 * Features:
 * - Nodes show character image or colored initials
 * - Node size reflects importance (Lead > Supporting > Featured > Background)
 * - Force-directed layout centers important characters
 * - Click node to select character, click edge to edit relationship
 * - Add relationship button per node
 * - Drag nodes to rearrange
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useEditorStore, type CharacterProfile, type CharacterRelationship } from '../stores/editorStore';

/* ════════════════════════════════════════════════════════════════════
   TYPES
   ════════════════════════════════════════════════════════════════════ */

interface GraphNode {
  id: string;              // uppercase character name
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  role: string;
  dialogueCount: number;
  profile: CharacterProfile | null;
  imageUrl?: string;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  rel: CharacterRelationship;
}

interface Props {
  /** Used to scope localStorage positions and force remount on file switch */
  scriptId?: string;
  onSelectCharacter?: (name: string) => void;
}

/* ════════════════════════════════════════════════════════════════════
   CONSTANTS
   ════════════════════════════════════════════════════════════════════ */

const ROLE_IMPORTANCE: Record<string, number> = {
  'Lead': 5, 'Supporting': 3, 'Featured': 2, 'Day Player': 1, 'Background': 1,
};

const REL_COLORS: Record<string, string> = {
  'allies': '#4caf50', 'family': '#2196f3', 'romantic': '#e91e63',
  'rivals': '#ff5722', 'antagonist': '#f44336', 'mentor': '#9c27b0',
  'employer': '#ff9800', 'friends': '#66bb6a',
};

const DEFAULT_NODE_COLORS = [
  '#8b5cf6', '#4f46e5', '#2563eb', '#059669', '#eab308',
  '#f97316', '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
];

/* ════════════════════════════════════════════════════════════════════
   FORCE SIMULATION
   ════════════════════════════════════════════════════════════════════ */

function runForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  iterations: number = 150,
): void {
  const cx = width / 2;
  const cy = height / 3; // Top-center for important characters

  // Group characters by importance tier
  const leads: GraphNode[] = [];
  const supporting: GraphNode[] = [];
  const minor: GraphNode[] = [];
  const edgeSet = new Set<string>();
  for (const e of edges) { edgeSet.add(e.source); edgeSet.add(e.target); }

  for (const node of nodes) {
    const importance = ROLE_IMPORTANCE[node.role] || 1;
    if (importance >= 4) leads.push(node);
    else if (importance >= 2 || edgeSet.has(node.id)) supporting.push(node);
    else minor.push(node);
  }

  // Initialize positions — hierarchy layout:
  // Row 1 (top): Lead characters evenly spaced on same horizontal line
  // Row 2 (middle): Supporting/connected characters in arc below leads
  // Row 3 (bottom): Minor/unconnected characters spread at bottom
  const leadSpacing = Math.min(140, (width - 100) / Math.max(1, leads.length));
  const leadStartX = cx - (leads.length - 1) * leadSpacing / 2;
  leads.forEach((node, i) => {
    node.x = leadStartX + i * leadSpacing;
    node.y = cy;
    node.vx = 0;
    node.vy = 0;
  });

  const supportArc = Math.PI * 0.7;
  const supportRadius = Math.min(180, Math.max(100, width * 0.25));
  supporting.forEach((node, i) => {
    const angle = -supportArc / 2 + (i / Math.max(1, supporting.length - 1)) * supportArc;
    node.x = cx + Math.sin(angle) * supportRadius;
    node.y = cy + 80 + Math.cos(angle) * supportRadius * 0.5;
    node.vx = 0;
    node.vy = 0;
  });

  const minorSpacing = Math.min(100, (width - 60) / Math.max(1, minor.length));
  const minorStartX = cx - (minor.length - 1) * minorSpacing / 2;
  minor.forEach((node, i) => {
    node.x = minorStartX + i * minorSpacing;
    node.y = height * 0.8 + (Math.random() - 0.5) * 20;
    node.vx = 0;
    node.vy = 0;
  });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;
    const strength = alpha * 0.35;

    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const minDist = (a.radius + b.radius) * 2.8;
        const force = (minDist * minDist) / (dist * dist) * strength * 1.5;
        dx /= dist;
        dy /= dist;
        a.vx -= dx * force;
        a.vy -= dy * force;
        b.vx += dx * force;
        b.vy += dy * force;
      }
    }

    // Attraction along edges — pull connected nodes closer
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const idealDist = (a.radius + b.radius) * 3.5;
      const force = (dist - idealDist) * strength * 0.06;
      dx /= dist;
      dy /= dist;
      a.vx += dx * force;
      a.vy += dy * force;
      b.vx -= dx * force;
      b.vy -= dy * force;
    }

    // Vertical gravity: important nodes pulled toward top, minor toward bottom
    for (const node of nodes) {
      const importance = ROLE_IMPORTANCE[node.role] || 1;
      const targetY = importance >= 4 ? cy : importance >= 2 ? cy + 100 : height * 0.7;
      node.vy += (targetY - node.y) * strength * 0.015;
      // Horizontal centering
      node.vx += (cx - node.x) * strength * 0.008;
    }

    // Apply velocities with damping
    for (const node of nodes) {
      node.vx *= 0.65;
      node.vy *= 0.65;
      node.x += node.vx;
      node.y += node.vy;
    }
  }
}

/* ════════════════════════════════════════════════════════════════════
   ADD/EDIT RELATIONSHIP FORM
   ════════════════════════════════════════════════════════════════════ */

const REL_TYPES = ['allies', 'rivals', 'family', 'romantic', 'mentor', 'antagonist', 'employer', 'friends'];
const REL_DYNAMICS = ['Stable', 'Evolving', 'Tense', 'One-sided', 'Supportive', 'Adversarial', 'Complex'];

interface RelFormProps {
  characterName: string;
  allCharacters: string[];
  /** If true, both characters are selectable (no fixed first character) */
  selectBoth?: boolean;
  existing?: CharacterRelationship;
  onSave: (rel: Omit<CharacterRelationship, 'id'> & { id?: string }) => void;
  onCancel: () => void;
}

const RelForm: React.FC<RelFormProps> = ({ characterName, allCharacters, selectBoth, existing, onSave, onCancel }) => {
  const [charA, setCharA] = useState(
    existing?.characterA || (selectBoth ? '' : characterName)
  );
  const [otherChar, setOtherChar] = useState(
    existing ? (existing.characterA === characterName ? existing.characterB : existing.characterA) : ''
  );
  const [relType, setRelType] = useState(existing?.type || 'allies');
  const [dynamic, setDynamic] = useState(existing?.dynamic || 'Stable');
  const [desc, setDesc] = useState(existing?.description || '');

  const effectiveA = selectBoth ? charA : characterName;

  const handleSubmit = () => {
    if (!effectiveA || !otherChar) return;
    onSave({
      id: existing?.id,
      characterA: effectiveA,
      characterB: otherChar,
      type: relType,
      dynamic,
      description: desc,
    });
  };

  const othersForB = allCharacters.filter((c) => c !== effectiveA);

  return (
    <div className="rel-map-form">
      {selectBoth && (
        <div className="rel-map-form-row">
          <label>Character A</label>
          <select value={charA} onChange={(e) => { setCharA(e.target.value); setOtherChar(''); }}>
            <option value="">Select...</option>
            {allCharacters.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}
      <div className="rel-map-form-row">
        <label>{selectBoth ? 'Character B' : 'Character'}</label>
        <select value={otherChar} onChange={(e) => setOtherChar(e.target.value)}>
          <option value="">Select...</option>
          {othersForB.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="rel-map-form-row">
        <label>Type</label>
        <select value={relType} onChange={(e) => setRelType(e.target.value)}>
          {REL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="rel-map-form-row">
        <label>Dynamic</label>
        <select value={dynamic} onChange={(e) => setDynamic(e.target.value)}>
          {REL_DYNAMICS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div className="rel-map-form-row">
        <label>Description</label>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="Describe the relationship..." />
      </div>
      <div className="rel-map-form-actions">
        <button className="rel-map-btn" onClick={onCancel}>Cancel</button>
        <button className="rel-map-btn rel-map-btn-primary" onClick={handleSubmit} disabled={!effectiveA || !otherChar}>
          {existing ? 'Update' : 'Add'}
        </button>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════ */

export const RelationshipMap: React.FC<Props> = ({ scriptId, onSelectCharacter }) => {
  const characters = useEditorStore((s) => s.characters);
  const characterProfiles = useEditorStore((s) => s.characterProfiles);
  const characterRelationships = useEditorStore((s) => s.characterRelationships);
  const upsertCharacterRelationship = useEditorStore((s) => s.upsertCharacterRelationship);
  const deleteCharacterRelationship = useEditorStore((s) => s.deleteCharacterRelationship);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dragNode, setDragNode] = useState<string | null>(null);
  const [editingRel, setEditingRel] = useState<CharacterRelationship | null>(null);
  const [addingFrom, setAddingFrom] = useState<string | null>(null);

  // Persist node positions in a ref + localStorage so they survive tab switches
  // Key includes scriptId so positions are per-file
  const positionsKey = `rel-map-positions-${scriptId || 'default'}`;
  const loadSavedPositions = (): Map<string, { x: number; y: number }> => {
    try {
      const raw = localStorage.getItem(positionsKey);
      if (raw) return new Map(JSON.parse(raw));
    } catch { /* ignore */ }
    return new Map();
  };
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(loadSavedPositions);

  // Save positions to localStorage when they change
  const savePositionsRef = useRef(nodePositions);
  savePositionsRef.current = nodePositions;
  useEffect(() => {
    return () => {
      // Save on unmount (tab switch)
      try {
        localStorage.setItem(positionsKey, JSON.stringify(Array.from(savePositionsRef.current.entries())));
      } catch { /* ignore */ }
    };
  }, []);
  // Also save periodically after drags
  const savePositions = useCallback((positions: Map<string, { x: number; y: number }>) => {
    setNodePositions(positions);
    try {
      localStorage.setItem(positionsKey, JSON.stringify(Array.from(positions.entries())));
    } catch { /* ignore */ }
  }, []);

  // Pan & zoom state
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 600, h: 400 });
  const [isPanning, setIsPanning] = useState(false);

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setDimensions({ width, height });
        // Initialize viewBox to match container on first measure
        setViewBox((prev) => prev.w === 600 && prev.h === 400
          ? { x: -50, y: -50, w: width + 100, h: height + 100 }
          : prev
        );
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Build graph data
  const { nodes, edges } = useMemo(() => {
    const profileMap = new Map(characterProfiles.map((p) => [p.name, p]));

    // Get dialogue counts from character stats
    const charStats = new Map<string, number>();
    // Simple heuristic: use profile existence + role as importance proxy
    for (const name of characters) {
      const profile = profileMap.get(name);
      const role = profile?.role || '';
      charStats.set(name, ROLE_IMPORTANCE[role] || 1);
    }

    // Include ALL characters from the script — every character gets a node
    const includeSet = new Set<string>(characters);
    // Also include characters referenced in relationships but not in the script list
    for (const rel of characterRelationships) {
      includeSet.add(rel.characterA);
      includeSet.add(rel.characterB);
    }

    const nodeList: GraphNode[] = Array.from(includeSet).map((name, i) => {
      const profile = profileMap.get(name) || null;
      const importance = charStats.get(name) || 1;
      const radius = 18 + importance * 6;
      const color = profile?.color || DEFAULT_NODE_COLORS[i % DEFAULT_NODE_COLORS.length];

      return {
        id: name,
        x: 0, y: 0, vx: 0, vy: 0,
        radius,
        color,
        role: profile?.role || '',
        dialogueCount: importance,
        profile,
      };
    });

    const edgeList: GraphEdge[] = characterRelationships.map((rel) => ({
      id: rel.id,
      source: rel.characterA,
      target: rel.characterB,
      rel,
    }));

    return { nodes: nodeList, edges: edgeList };
  }, [characters, characterProfiles, characterRelationships]);

  // Run layout — uses viewBox area, not pixel dimensions
  useEffect(() => {
    if (nodes.length === 0) return;
    const w = Math.max(dimensions.width, 500);
    const h = Math.max(dimensions.height, 400);
    const layoutNodes = nodes.map((n) => {
      const saved = nodePositions.get(n.id);
      return { ...n, x: saved?.x ?? 0, y: saved?.y ?? 0 };
    });
    // Only run force layout if we don't have saved positions for all nodes
    const needsLayout = layoutNodes.some((n) => n.x === 0 && n.y === 0);
    if (needsLayout) {
      runForceLayout(layoutNodes, edges, w, h);
      const newPositions = new Map<string, { x: number; y: number }>(nodePositions);
      for (const n of layoutNodes) newPositions.set(n.id, { x: n.x, y: n.y });
      savePositions(newPositions);
      // Fit viewBox to contain all nodes
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of layoutNodes) {
        minX = Math.min(minX, n.x - n.radius - 30);
        minY = Math.min(minY, n.y - n.radius - 30);
        maxX = Math.max(maxX, n.x + n.radius + 30);
        maxY = Math.max(maxY, n.y + n.radius + 30);
      }
      const pad = 60;
      setViewBox({ x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 });
    }
  }, [nodes.length, edges.length, dimensions.width, dimensions.height]);

  // Render nodes with current positions
  const positionedNodes = useMemo(() => {
    return nodes.map((n) => {
      const pos = nodePositions.get(n.id);
      return { ...n, x: pos?.x ?? dimensions.width / 2, y: pos?.y ?? dimensions.height / 2 };
    });
  }, [nodes, nodePositions, dimensions]);

  // Convert screen coords to SVG viewBox coords using the SVG's own CTM
  // This is always accurate regardless of viewBox, zoom, or container size
  const screenToSvg = useCallback((clientX: number, clientY: number) => {
    const svg = containerRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return { x: clientX, y: clientY };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const svgPt = pt.matrixTransform(ctm.inverse());
    return { x: svgPt.x, y: svgPt.y };
  }, []); // No dependencies — CTM is read live from the DOM

  // Drag node handling
  const handlePointerDown = useCallback((name: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragNode(name);
    setSelectedNode(name);

    const onMove = (ev: PointerEvent) => {
      const pos = screenToSvg(ev.clientX, ev.clientY);
      setNodePositions((prev) => {
        const next = new Map(prev);
        next.set(name, pos);
        return next;
      });
    };
    const onUp = () => {
      setDragNode(null);
      // Save after drag ends
      savePositions(savePositionsRef.current);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [screenToSvg, savePositions]);

  // Pan handling (drag on empty SVG area)
  // Uses pixel deltas (not SVG coords) to avoid feedback loop with viewBox changes
  const handleSvgPointerDown = useCallback((e: React.PointerEvent) => {
    // Only if clicking on the SVG background, not a node
    const target = e.target as Element;
    if (target.tagName !== 'svg') return;
    e.preventDefault();
    setIsPanning(true);
    let lastX = e.clientX;
    let lastY = e.clientY;

    const onMove = (ev: PointerEvent) => {
      const svg = containerRef.current?.querySelector('svg') as SVGSVGElement | null;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      setViewBox((v) => ({
        ...v,
        x: v.x - dx * (v.w / rect.width),
        y: v.y - dy * (v.h / rect.height),
      }));
    };
    const onUp = () => {
      setIsPanning(false);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, []);

  // Zoom via scroll wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    const svg = containerRef.current?.querySelector('svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Zoom centered on cursor position
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    setViewBox((v) => {
      const newW = v.w * factor;
      const newH = v.h * factor;
      return {
        x: v.x + (v.w - newW) * mx,
        y: v.y + (v.h - newH) * my,
        w: newW,
        h: newH,
      };
    });
  }, []);

  const handleSaveRel = useCallback((data: Omit<CharacterRelationship, 'id'> & { id?: string }) => {
    const rel: CharacterRelationship = {
      id: data.id || crypto.randomUUID(),
      characterA: data.characterA,
      characterB: data.characterB,
      type: data.type,
      description: data.description,
      dynamic: data.dynamic,
    };
    upsertCharacterRelationship(rel);
    setEditingRel(null);
    setAddingFrom(null);
  }, [upsertCharacterRelationship]);

  const nodeMap = useMemo(() => new Map(positionedNodes.map((n) => [n.id, n])), [positionedNodes]);

  if (nodes.length === 0) {
    return (
      <div className="rel-map-empty">
        <p>No characters in the screenplay yet.</p>
        <p style={{ fontSize: 11, color: 'var(--fd-text-muted)' }}>
          Add character elements to your screenplay to see them here.
        </p>
      </div>
    );
  }

  return (
    <div className="rel-map-container" ref={containerRef} onWheel={handleWheel as any}>
      <svg
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="rel-map-svg"
        style={{ cursor: isPanning ? 'grabbing' : 'default' }}
        onClick={() => { setSelectedNode(null); setAddingFrom(null); }}
        onPointerDown={handleSvgPointerDown}
      >
        {/* Edges */}
        {edges.map((edge) => {
          const s = nodeMap.get(edge.source);
          const t = nodeMap.get(edge.target);
          if (!s || !t) return null;
          const relColor = REL_COLORS[edge.rel.type] || '#666';
          const midX = (s.x + t.x) / 2;
          const midY = (s.y + t.y) / 2;
          const isSelected = selectedNode === edge.source || selectedNode === edge.target;

          return (
            <g key={edge.id}>
              <line
                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={relColor}
                strokeWidth={isSelected ? 2.5 : 1.5}
                strokeOpacity={isSelected ? 1 : 0.5}
                style={{ cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); setEditingRel(edge.rel); }}
              />
              <text
                x={midX} y={midY - 6}
                textAnchor="middle"
                fontSize={9}
                fill={relColor}
                fontWeight={600}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {edge.rel.type}
              </text>
              {edge.rel.dynamic && (
                <text
                  x={midX} y={midY + 5}
                  textAnchor="middle"
                  fontSize={8}
                  fill="var(--fd-text-muted, #888)"
                  fontStyle="italic"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {edge.rel.dynamic}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {positionedNodes.map((node) => {
          const isSelected = selectedNode === node.id;
          const initials = node.id.slice(0, 2);
          const roleLabel = node.role || '';

          return (
            <g
              key={node.id}
              style={{ cursor: dragNode === node.id ? 'grabbing' : 'grab' }}
              onPointerDown={(e) => handlePointerDown(node.id, e)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (onSelectCharacter) onSelectCharacter(node.id);
              }}
            >
              {/* Glow for selected */}
              {isSelected && (
                <circle cx={node.x} cy={node.y} r={node.radius + 4} fill="none" stroke={node.color} strokeWidth={2} strokeOpacity={0.5} />
              )}
              {/* Node circle */}
              <circle
                cx={node.x} cy={node.y} r={node.radius}
                fill={node.color}
                fillOpacity={0.15}
                stroke={node.color}
                strokeWidth={isSelected ? 2.5 : 1.5}
              />
              {/* Initials */}
              <text
                x={node.x} y={node.y + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={node.radius * 0.65}
                fontWeight={700}
                fill={node.color}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {initials}
              </text>
              {/* Name label below */}
              <text
                x={node.x} y={node.y + node.radius + 12}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill="var(--fd-text, #ccc)"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {node.id}
              </text>
              {/* Role badge */}
              {roleLabel && (
                <text
                  x={node.x} y={node.y + node.radius + 22}
                  textAnchor="middle"
                  fontSize={8}
                  fill="var(--fd-text-muted, #888)"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {roleLabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Toolbar overlay */}
      <div className="rel-map-toolbar">
        {selectedNode ? (
          <>
            <span className="rel-map-toolbar-label">{selectedNode}</span>
            <button
              className="rel-map-btn rel-map-btn-primary"
              onClick={() => setAddingFrom(selectedNode)}
            >
              + Add Relationship
            </button>
            {onSelectCharacter && (
              <button
                className="rel-map-btn"
                onClick={() => onSelectCharacter(selectedNode)}
              >
                View Profile
              </button>
            )}
          </>
        ) : (
          <>
            <span className="rel-map-toolbar-hint">Scroll to zoom. Drag background to pan.</span>
            {nodes.length >= 2 && (
              <button
                className="rel-map-btn rel-map-btn-primary"
                onClick={() => setAddingFrom('__BOTH__')}
              >
                + Add Relationship
              </button>
            )}
          </>
        )}
        <button
          className="rel-map-btn"
          style={{ marginLeft: 'auto' }}
          onClick={() => {
            // Fit viewBox to contain all nodes
            if (positionedNodes.length === 0) return;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const n of positionedNodes) {
              minX = Math.min(minX, n.x - n.radius - 30);
              minY = Math.min(minY, n.y - n.radius - 30);
              maxX = Math.max(maxX, n.x + n.radius + 30);
              maxY = Math.max(maxY, n.y + n.radius + 30);
            }
            const pad = 60;
            setViewBox({ x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 });
          }}
          title="Fit all characters to screen"
        >
          Fit
        </button>
      </div>

      {/* Add/Edit relationship form overlay */}
      {(addingFrom || editingRel) && (
        <div className="rel-map-form-overlay" onClick={() => { setAddingFrom(null); setEditingRel(null); }}>
          <div onClick={(e) => e.stopPropagation()}>
            <RelForm
              characterName={addingFrom === '__BOTH__' ? '' : (addingFrom || editingRel!.characterA)}
              selectBoth={addingFrom === '__BOTH__'}
              allCharacters={characters}
              existing={editingRel || undefined}
              onSave={handleSaveRel}
              onCancel={() => { setAddingFrom(null); setEditingRel(null); }}
            />
            {editingRel && (
              <button
                className="rel-map-btn rel-map-btn-danger"
                style={{ marginTop: 8, width: '100%' }}
                onClick={() => { deleteCharacterRelationship(editingRel.id); setEditingRel(null); }}
              >
                Delete Relationship
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
