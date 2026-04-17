import React, { useMemo, useState } from 'react';
import type { JSONContent } from '@tiptap/react';
import { computeScriptDiff, type DiffBlock, type WordDiff } from '../utils/scriptDiff';

interface Props {
  docA: JSONContent;
  docB: JSONContent;
  labelA: string;
  labelB: string;
  onClose?: () => void;
}

type ViewMode = 'side-by-side' | 'unified' | 'changes-only';

const ELEMENT_LABEL: Record<string, string> = {
  sceneHeading: 'Scene',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
  general: 'General',
  shot: 'Shot',
  newAct: 'Act Break',
  endOfAct: 'End of Act',
};

const ScriptDiffView: React.FC<Props> = ({ docA, docB, labelA, labelB, onClose }) => {
  const [mode, setMode] = useState<ViewMode>('side-by-side');
  const [showSummary, setShowSummary] = useState(true);

  const diff = useMemo(() => computeScriptDiff(docA, docB), [docA, docB]);

  const displayBlocks = useMemo(() => {
    if (mode === 'changes-only') return diff.blocks.filter((b) => b.type !== 'unchanged');
    return diff.blocks;
  }, [diff.blocks, mode]);

  return (
    <div className="script-diff-view">
      <div className="script-diff-header">
        <div className="script-diff-titles">
          <span className="script-diff-label">
            <span className="script-diff-label-badge script-diff-label-a">A</span>
            {labelA}
          </span>
          <span className="script-diff-arrow">→</span>
          <span className="script-diff-label">
            <span className="script-diff-label-badge script-diff-label-b">B</span>
            {labelB}
          </span>
        </div>
        <div className="script-diff-controls">
          <button
            className={`script-diff-mode-btn${mode === 'side-by-side' ? ' active' : ''}`}
            onClick={() => setMode('side-by-side')}
          >Side-by-side</button>
          <button
            className={`script-diff-mode-btn${mode === 'unified' ? ' active' : ''}`}
            onClick={() => setMode('unified')}
          >Unified</button>
          <button
            className={`script-diff-mode-btn${mode === 'changes-only' ? ' active' : ''}`}
            onClick={() => setMode('changes-only')}
          >Changes only</button>
          <button
            className="script-diff-summary-btn"
            onClick={() => setShowSummary((v) => !v)}
          >{showSummary ? 'Hide Summary' : 'Show Summary'}</button>
          {onClose && (
            <button className="script-diff-close" onClick={onClose} title="Close diff">×</button>
          )}
        </div>
      </div>

      <div className="script-diff-body">
        <div className="script-diff-main">
          {displayBlocks.length === 0 ? (
            <div className="script-diff-empty">No differences.</div>
          ) : mode === 'side-by-side' ? (
            <SideBySideDiff blocks={displayBlocks} />
          ) : (
            <UnifiedDiff blocks={displayBlocks} />
          )}
        </div>
        {showSummary && (
          <div className="script-diff-summary">
            <h4>Summary</h4>
            <div className="script-diff-summary-row">
              <span className="script-diff-chip-added">+{diff.summary.totalAdded}</span>
              added
            </div>
            <div className="script-diff-summary-row">
              <span className="script-diff-chip-removed">−{diff.summary.totalDeleted}</span>
              deleted
            </div>
            <div className="script-diff-summary-row">
              <span className="script-diff-chip-modified">~{diff.summary.totalModified}</span>
              modified
            </div>
            {diff.summary.scenesChanged.length > 0 && (
              <>
                <h5>Scenes changed ({diff.summary.scenesChanged.length})</h5>
                <ul className="script-diff-scenes">
                  {diff.summary.scenesChanged.slice(0, 20).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                  {diff.summary.scenesChanged.length > 20 && (
                    <li><em>+{diff.summary.scenesChanged.length - 20} more</em></li>
                  )}
                </ul>
              </>
            )}
            {diff.summary.dialogueDelta.length > 0 && (
              <>
                <h5>Dialogue changes</h5>
                <ul className="script-diff-dialogue-delta">
                  {diff.summary.dialogueDelta.map((d) => (
                    <li key={d.character}>
                      <strong>{d.character}</strong>
                      <span className="script-diff-chip-added">+{d.added}</span>
                      <span className="script-diff-chip-removed">−{d.removed}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Side-by-side renderer ──────────────────────────────────────────────────

const SideBySideDiff: React.FC<{ blocks: DiffBlock[] }> = ({ blocks }) => (
  <div className="diff-sbs">
    <div className="diff-sbs-col">
      {blocks.map((b, i) => (
        <BlockView key={`a-${i}`} side="a" block={b} />
      ))}
    </div>
    <div className="diff-sbs-col">
      {blocks.map((b, i) => (
        <BlockView key={`b-${i}`} side="b" block={b} />
      ))}
    </div>
  </div>
);

const BlockView: React.FC<{ side: 'a' | 'b'; block: DiffBlock }> = ({ side, block }) => {
  const showHere =
    block.type === 'unchanged' ||
    (side === 'a' && (block.type === 'deleted' || block.type === 'modified')) ||
    (side === 'b' && (block.type === 'added' || block.type === 'modified'));

  if (!showHere) {
    return <div className={`diff-block diff-empty diff-${block.type}`} />;
  }

  const text = side === 'a' ? block.oldText : block.newText;
  const typeLabel = ELEMENT_LABEL[block.elementType] || block.elementType;

  return (
    <div className={`diff-block diff-${block.type} diff-el-${block.elementType}`}>
      <div className="diff-block-label">{typeLabel}</div>
      <div className="diff-block-content">
        {block.type === 'modified' && block.wordDiffs ? (
          <WordDiffView diffs={block.wordDiffs} side={side} />
        ) : (
          <span>{text}</span>
        )}
      </div>
    </div>
  );
};

const WordDiffView: React.FC<{ diffs: WordDiff[]; side: 'a' | 'b' }> = ({ diffs, side }) => (
  <>
    {diffs.map((d, i) => {
      if (d.kind === 'same') return <span key={i}>{d.text}</span>;
      if (d.kind === 'removed' && side === 'a') {
        return <span key={i} className="word-removed">{d.text}</span>;
      }
      if (d.kind === 'added' && side === 'b') {
        return <span key={i} className="word-added">{d.text}</span>;
      }
      return null;
    })}
  </>
);

// ── Unified renderer ──────────────────────────────────────────────────────

const UnifiedDiff: React.FC<{ blocks: DiffBlock[] }> = ({ blocks }) => (
  <div className="diff-unified">
    {blocks.map((b, i) => {
      const typeLabel = ELEMENT_LABEL[b.elementType] || b.elementType;
      if (b.type === 'unchanged') {
        return (
          <div key={i} className={`diff-block diff-unchanged diff-el-${b.elementType}`}>
            <div className="diff-block-label">{typeLabel}</div>
            <div className="diff-block-content">{b.oldText}</div>
          </div>
        );
      }
      if (b.type === 'modified' && b.wordDiffs) {
        return (
          <div key={i} className={`diff-block diff-modified diff-el-${b.elementType}`}>
            <div className="diff-block-label">{typeLabel} (modified)</div>
            <div className="diff-block-content">
              <WordDiffView diffs={b.wordDiffs} side="a" />
              {' → '}
              <WordDiffView diffs={b.wordDiffs} side="b" />
            </div>
          </div>
        );
      }
      if (b.type === 'deleted') {
        return (
          <div key={i} className={`diff-block diff-deleted diff-el-${b.elementType}`}>
            <div className="diff-block-label">{typeLabel} (deleted)</div>
            <div className="diff-block-content"><del>{b.oldText}</del></div>
          </div>
        );
      }
      return (
        <div key={i} className={`diff-block diff-added diff-el-${b.elementType}`}>
          <div className="diff-block-label">{typeLabel} (added)</div>
          <div className="diff-block-content">{b.newText}</div>
        </div>
      );
    })}
  </div>
);

export default ScriptDiffView;
