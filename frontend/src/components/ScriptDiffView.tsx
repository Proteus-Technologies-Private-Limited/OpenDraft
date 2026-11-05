import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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

/**
 * Deliberately *not* `ELEMENT_LABELS` from editorStore.
 *
 * These are abbreviated for the diff gutter, which is a narrow column beside
 * every block: "Scene" rather than "Scene Heading", "Act Break" rather than
 * "New Act", and plain "General" rather than the picker's more explanatory
 * "General (Unformatted text)". The picker has room to teach; this does not.
 */
type CollabT = TFunction<'collab'>;

// Looked up by element id (the name stored in the document); the unknown id is
// shown as-is, exactly as before.
const labelFor = (elementType: string, t: CollabT): string => {
  switch (elementType) {
    case 'sceneHeading': return t('diff.element.sceneHeading');
    case 'action': return t('diff.element.action');
    case 'character': return t('diff.element.character');
    case 'dialogue': return t('diff.element.dialogue');
    case 'parenthetical': return t('diff.element.parenthetical');
    case 'transition': return t('diff.element.transition');
    case 'general': return t('diff.element.general');
    case 'shot': return t('diff.element.shot');
    case 'newAct': return t('diff.element.newAct');
    case 'endOfAct': return t('diff.element.endOfAct');
    default: return elementType;
  }
};

const elementLabel = (block: DiffBlock, t: CollabT): string => {
  const label = labelFor(block.elementType, t);
  const oldLabel = block.oldElementType ? labelFor(block.oldElementType, t) : null;
  return oldLabel && oldLabel !== label ? t('diff.elementChange', { from: oldLabel, to: label }) : label;
};

const movedTitle = (block: DiffBlock, t: CollabT): string | undefined => {
  if (block.type !== 'moved') return undefined;
  if (!block.oldSceneHeading || block.oldSceneHeading === block.sceneHeading) return t('diff.moved');
  return t('diff.movedFromTo', { from: block.oldSceneHeading, to: block.sceneHeading || t('diff.theEnd') });
};

const ScriptDiffView: React.FC<Props> = ({ docA, docB, labelA, labelB, onClose }) => {
  const { t } = useTranslation('collab');
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
          >{t('diff.sideBySide')}</button>
          <button
            className={`script-diff-mode-btn${mode === 'unified' ? ' active' : ''}`}
            onClick={() => setMode('unified')}
          >{t('diff.unified')}</button>
          <button
            className={`script-diff-mode-btn${mode === 'changes-only' ? ' active' : ''}`}
            onClick={() => setMode('changes-only')}
          >{t('diff.changesOnly')}</button>
          <button
            className="script-diff-summary-btn"
            onClick={() => setShowSummary((v) => !v)}
          >{showSummary ? t('diff.hideSummary') : t('diff.showSummary')}</button>
          {onClose && (
            <button className="script-diff-close" onClick={onClose} title={t('diff.closeTitle')}>×</button>
          )}
        </div>
      </div>

      <div className="script-diff-body">
        <div className="script-diff-main">
          {displayBlocks.length === 0 ? (
            <div className="script-diff-empty">{t('diff.none')}</div>
          ) : mode === 'side-by-side' ? (
            <SideBySideDiff blocks={displayBlocks} />
          ) : (
            <UnifiedDiff blocks={displayBlocks} />
          )}
        </div>
        {showSummary && (
          <div className="script-diff-summary">
            <h4>{t('diff.summary')}</h4>
            <div className="script-diff-summary-row">
              <span className="script-diff-chip-added">+{diff.summary.totalAdded}</span>
              {t('diff.added')}
            </div>
            <div className="script-diff-summary-row">
              <span className="script-diff-chip-removed">−{diff.summary.totalDeleted}</span>
              {t('diff.deleted')}
            </div>
            <div className="script-diff-summary-row">
              <span className="script-diff-chip-modified">~{diff.summary.totalModified}</span>
              {t('diff.modified')}
            </div>
            <div className="script-diff-summary-row">
              <span className="script-diff-chip-moved">{diff.summary.totalMoved}</span>
              {t('diff.movedCount')}
            </div>
            {diff.summary.scenesChanged.length > 0 && (
              <>
                <h5>{t('diff.scenesChanged', { count: diff.summary.scenesChanged.length })}</h5>
                <ul className="script-diff-scenes">
                  {diff.summary.scenesChanged.slice(0, 20).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                  {diff.summary.scenesChanged.length > 20 && (
                    <li><em>{t('diff.more', { count: diff.summary.scenesChanged.length - 20 })}</em></li>
                  )}
                </ul>
              </>
            )}
            {diff.summary.dialogueDelta.length > 0 && (
              <>
                <h5>{t('diff.dialogueChanges')}</h5>
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
  const { t } = useTranslation('collab');
  const showHere =
    block.type === 'unchanged' ||
    block.type === 'moved' ||
    (side === 'a' && (block.type === 'deleted' || block.type === 'modified')) ||
    (side === 'b' && (block.type === 'added' || block.type === 'modified'));

  if (!showHere) {
    return <div className={`diff-block diff-empty diff-${block.type}`} />;
  }

  const text = side === 'a' ? block.oldText : block.newText;
  const typeLabel = elementLabel(block, t);

  return (
    <div
      className={`diff-block diff-${block.type} diff-el-${block.elementType}`}
      title={movedTitle(block, t)}
    >
      <div className="diff-block-label">
        {block.type === 'moved' ? t('diff.labelDotMoved', { label: typeLabel }) : typeLabel}
      </div>
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

const UnifiedDiff: React.FC<{ blocks: DiffBlock[] }> = ({ blocks }) => {
  const { t } = useTranslation('collab');
  return (
  <div className="diff-unified">
    {blocks.map((b, i) => {
      const typeLabel = elementLabel(b, t);
      if (b.type === 'unchanged') {
        return (
          <div key={i} className={`diff-block diff-unchanged diff-el-${b.elementType}`}>
            <div className="diff-block-label">{typeLabel}</div>
            <div className="diff-block-content">{b.oldText}</div>
          </div>
        );
      }
      if (b.type === 'moved') {
        return (
          <div
            key={i}
            className={`diff-block diff-moved diff-el-${b.elementType}`}
            title={movedTitle(b, t)}
          >
            <div className="diff-block-label">{t('diff.labelMoved', { label: typeLabel })}</div>
            <div className="diff-block-content">{b.newText}</div>
          </div>
        );
      }
      if (b.type === 'modified' && b.wordDiffs) {
        return (
          <div key={i} className={`diff-block diff-modified diff-el-${b.elementType}`}>
            <div className="diff-block-label">{t('diff.labelModified', { label: typeLabel })}</div>
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
            <div className="diff-block-label">{t('diff.labelDeleted', { label: typeLabel })}</div>
            <div className="diff-block-content"><del>{b.oldText}</del></div>
          </div>
        );
      }
      return (
        <div key={i} className={`diff-block diff-added diff-el-${b.elementType}`}>
          <div className="diff-block-label">{t('diff.labelAdded', { label: typeLabel })}</div>
          <div className="diff-block-content">{b.newText}</div>
        </div>
      );
    })}
  </div>
  );
};

export default ScriptDiffView;
