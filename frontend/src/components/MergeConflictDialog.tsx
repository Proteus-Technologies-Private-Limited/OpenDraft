/**
 * Settles a script changed both on this device and in OpenDraft Cloud.
 *
 * The writer can keep one whole version, or merge: changes made on one side
 * only are already in (listed under "merged automatically"), and each place
 * where the two sides changed the same thing is a card with a choice — this
 * device, the cloud, or (for script text) both. The Compare tab shows the same
 * screenplay-aware diff as version history, between any two of the copies.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { JSONContent } from '@tiptap/core';
import { ModalOverlay } from './ModalOverlay';
import '../styles/mergeConflict.css';
import ScriptDiffView from './ScriptDiffView';
import { diffWords } from '../utils/scriptDiff';
import { jsonBlockText } from '../utils/nodeText';
import {
  applyMerge, choicesFor, mergeScripts, recordLabel,
  type ItemConflict, type MergeChoice, type MergeConflict, type MergeSegment, type ScriptContent, type TextConflict,
} from '../utils/scriptMerge';

export type MergeOutcome =
  | { kind: 'device' }
  | { kind: 'cloud' }
  | { kind: 'merged'; content: ScriptContent };

interface Props {
  title: string;
  base: ScriptContent | null;
  device: ScriptContent;
  cloud: ScriptContent;
  /** Throws to keep the dialog open; the message is shown to the writer. */
  onResolve: (outcome: MergeOutcome) => Promise<void>;
  onClose: () => void;
  /** Hide "keep one whole version" where the caller has its own buttons for it. */
  allowWhole?: boolean;
}

type Compare = 'cloudDevice' | 'baseDevice' | 'baseCloud' | 'deviceMerged' | 'cloudMerged';

const ELEMENT_KEYS: Record<string, string> = {
  sceneHeading: 'diff.element.sceneHeading', action: 'diff.element.action', character: 'diff.element.character',
  dialogue: 'diff.element.dialogue', parenthetical: 'diff.element.parenthetical', transition: 'diff.element.transition',
  general: 'diff.element.general', shot: 'diff.element.shot', newAct: 'diff.element.newAct', endOfAct: 'diff.element.endOfAct',
};

function elementLabel(type: string | undefined, t: TFunction<'collab'>) {
  const key = type && ELEMENT_KEYS[type];
  return key ? t(key as 'diff.element.action') : (type ?? '');

}

/** Words that differ between a paragraph and its counterpart on the other side. */
function Highlighted({ text, other, kind }: { text: string; other: string | null; kind: 'device' | 'cloud' }) {
  if (other === null || other === text) return <>{text}</>;
  const parts = kind === 'device' ? diffWords(other, text) : diffWords(text, other);
  const keep = kind === 'device' ? 'added' : 'removed';
  return (
    <>
      {parts.filter(part => part.kind === 'same' || part.kind === keep).map((part, index) => (
        part.kind === 'same' ? <span key={index}>{part.text}</span>
          : <mark key={index} className={`merge-word merge-word-${kind}`}>{part.text}</mark>
      ))}
    </>
  );
}

function Blocks({ blocks, counterpart, side }: {
  blocks: JSONContent[]; counterpart: JSONContent[]; side: 'device' | 'cloud';
}) {
  const { t } = useTranslation('projects');
  const { t: tc } = useTranslation('collab');
  if (!blocks.length) return <p className="merge-empty">{t('merge.empty')}</p>;
  // Same number of paragraphs on both sides: compare them pairwise, word by word.
  const paired = blocks.length === counterpart.length;
  return (
    <div className="merge-blocks">
      {blocks.map((block, index) => (
        <div key={index} className={`merge-block merge-el-${block.type ?? 'unknown'}`}>
          <span className="merge-block-type">{elementLabel(block.type, tc)}</span>
          <span className="merge-block-text">
            <Highlighted text={jsonBlockText(block)} kind={side}
              other={paired ? jsonBlockText(counterpart[index]) : null} />
          </span>
        </div>
      ))}
    </div>
  );
}

function valuePreview(value: unknown, t: TFunction<'projects'>): string {
  if (value === undefined) return t('merge.deleted');
  const label = recordLabel(value);
  if (label) return label;
  if (value === null || typeof value !== 'object') return String(value);
  const text = JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function itemTitle(conflict: ItemConflict, t: TFunction<'projects'>) {
  const kind = t(`merge.item.${conflict.key}` as 'merge.item.setting', { defaultValue: '' }) || t('merge.item.setting');
  if (conflict.itemId !== undefined) return conflict.label ? `${kind}: ${conflict.label}` : kind;
  return `${kind}: ${conflict.key.replace(/^_/, '')}`;
}

function ConflictCard({ conflict, choice, onChoose, index }: {
  conflict: MergeConflict; choice: MergeChoice | undefined; onChoose: (choice: MergeChoice) => void; index: number;
}) {
  const { t } = useTranslation('projects');
  const labels: Record<MergeChoice, string> = {
    device: t('merge.pickDevice'), cloud: t('merge.pickCloud'), both: t('merge.pickBoth'),
  };
  const text = conflict.kind === 'text' ? conflict as TextConflict : null;
  const heading = text
    ? (text.scene ? t('merge.inScene', { scene: text.scene }) : t('merge.noScene'))
    : itemTitle(conflict as ItemConflict, t);
  const side = (which: 'device' | 'cloud'): ReactNode => text
    ? <Blocks blocks={text[which]} counterpart={text[which === 'device' ? 'cloud' : 'device']} side={which} />
    : <p className="merge-value">{valuePreview((conflict as ItemConflict)[which], t)}</p>;
  return (
    <section className={`merge-card${choice ? ' merge-card-done' : ''}`} aria-label={heading}>
      <header className="merge-card-header">
        <span className="merge-card-number">{index + 1}</span>
        <span className="merge-card-title">{heading}</span>
        {choice && <span className="merge-card-chosen">{t('merge.chosen')}: {labels[choice]}</span>}
      </header>
      <div className="merge-card-sides">
        <div className={`merge-side merge-side-device${choice === 'device' || choice === 'both' ? ' merge-side-picked' : ''}`}>
          <div className="merge-side-label">{t('merge.deviceSide')}</div>
          {side('device')}
        </div>
        <div className={`merge-side merge-side-cloud${choice === 'cloud' || choice === 'both' ? ' merge-side-picked' : ''}`}>
          <div className="merge-side-label">{t('merge.cloudSide')}</div>
          {side('cloud')}
        </div>
      </div>
      <div className="merge-card-actions" role="radiogroup" aria-label={heading}>
        {choicesFor(conflict).map(option => (
          <button key={option} type="button" role="radio" aria-checked={choice === option}
            className={`merge-choice${choice === option ? ' active' : ''}`} onClick={() => onChoose(option)}>
            {labels[option]}
          </button>
        ))}
      </div>
    </section>
  );
}

function AutoList({ segments }: { segments: MergeSegment[] }) {
  const { t } = useTranslation('projects');
  const changes = segments.filter((s): s is Extract<MergeSegment, { kind: 'auto' }> => s.kind === 'auto' && s.from !== 'both');
  if (!changes.length) return null;
  return (
    <details className="merge-auto">
      <summary>{t('merge.autoTitle', { count: changes.length })}</summary>
      <ul>
        {changes.map((change, index) => (
          <li key={index}>
            <span className={`merge-origin merge-origin-${change.from}`}>
              {change.from === 'device' ? t('merge.fromDevice') : t('merge.fromCloud')}
            </span>
            <span className={`merge-auto-text${change.blocks.length ? '' : ' merge-auto-removed'}`}>
              {(change.blocks.length ? change.blocks : change.replaced)
                .map(jsonBlockText).filter(Boolean).join(' / ').slice(0, 200)}
            </span>
            {!change.blocks.length && <span className="merge-auto-note"> {t('merge.empty')}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function MergeConflictDialog({ title, base, device, cloud, onResolve, onClose, allowWhole = true }: Props) {
  const { t } = useTranslation('projects');
  const [tab, setTab] = useState<'merge' | 'compare'>('merge');
  const [compare, setCompare] = useState<Compare>('cloudDevice');
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const result = useMemo(() => mergeScripts(base, device, cloud), [base, device, cloud]);
  const merged = useMemo(() => applyMerge(result, choices), [result, choices]);
  const remaining = result.conflicts.filter(conflict => !choices[conflict.id]).length;
  const autoCount = result.autoFromDevice + result.autoFromCloud;

  const chooseAll = (choice: 'device' | 'cloud') =>
    setChoices(Object.fromEntries(result.conflicts.map(conflict => [conflict.id, choice])));

  const resolve = async (outcome: MergeOutcome) => {
    setBusy(true);
    setError(null);
    try {
      await onResolve(outcome);
    } catch (failure) {
      console.error('[merge] could not settle the conflict:', failure);
      setError(failure instanceof Error && failure.message ? failure.message : t('merge.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const compareDocs: Record<Compare, [ScriptContent | null, ScriptContent, string, string]> = {
    cloudDevice: [cloud, device, t('merge.cloudSide'), t('merge.deviceSide')],
    baseDevice: [base, device, t('merge.baseSide'), t('merge.deviceSide')],
    baseCloud: [base, cloud, t('merge.baseSide'), t('merge.cloudSide')],
    deviceMerged: [device, merged, t('merge.deviceSide'), t('merge.mergedSide')],
    cloudMerged: [cloud, merged, t('merge.cloudSide'), t('merge.mergedSide')],
  };
  const options = (Object.keys(compareDocs) as Compare[]).filter(key => key !== 'baseDevice' && key !== 'baseCloud' || !!base);
  const [docA, docB, labelA, labelB] = compareDocs[compare];

  return (
    <ModalOverlay className="merge-overlay" dialogLabel={t('merge.title')} role="dialog" aria-modal="true">
      <div className="merge-dialog">
        <header className="merge-header">
          <div className="merge-heading">
            <h2>{t('merge.title')}</h2>
            <p>{t('merge.subtitle', { title })}</p>
          </div>
          <div className="merge-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'merge'}
              className={`merge-tab${tab === 'merge' ? ' active' : ''}`} onClick={() => setTab('merge')}>{t('merge.tabMerge')}</button>
            <button type="button" role="tab" aria-selected={tab === 'compare'}
              className={`merge-tab${tab === 'compare' ? ' active' : ''}`} onClick={() => setTab('compare')}>{t('merge.tabCompare')}</button>
          </div>
          <button type="button" className="merge-close" onClick={onClose} disabled={busy}
            aria-label={t('merge.close')} title={t('merge.close')}>×</button>
        </header>

        {tab === 'merge' ? (
          <div className="merge-body">
            {result.identical ? <p className="merge-summary">{t('merge.identical')}</p> : (
              <>
                <p className="merge-summary">
                  {autoCount > 0 && <>{t('merge.autoMerged', { count: autoCount })} </>}
                  {result.conflicts.length
                    ? t('merge.needChoice', { count: result.conflicts.length })
                    : t('merge.noOverlap')}
                </p>
                {result.twoWay && <p className="merge-note">{t('merge.twoWay')}</p>}
                {result.conflicts.length > 1 && (
                  <div className="merge-bulk">
                    <button type="button" className="merge-choice" onClick={() => chooseAll('device')}>{t('merge.allDevice')}</button>
                    <button type="button" className="merge-choice" onClick={() => chooseAll('cloud')}>{t('merge.allCloud')}</button>
                  </div>
                )}
                {result.conflicts.map((conflict, index) => (
                  <ConflictCard key={conflict.id} conflict={conflict} index={index} choice={choices[conflict.id]}
                    onChoose={choice => setChoices(current => ({ ...current, [conflict.id]: choice }))} />
                ))}
                <AutoList segments={result.segments} />
              </>
            )}
          </div>
        ) : (
          <div className="merge-compare">
            <label className="merge-compare-picker">
              {t('merge.compareWith')}{' '}
              <select value={compare} onChange={event => setCompare(event.target.value as Compare)}>
                {options.map(option => (
                  <option key={option} value={option}>
                    {t(({
                      cloudDevice: 'merge.compareCloudDevice', baseDevice: 'merge.compareBaseDevice',
                      baseCloud: 'merge.compareBaseCloud', deviceMerged: 'merge.compareDeviceMerged',
                      cloudMerged: 'merge.compareCloudMerged',
                    } as const)[option])}
                  </option>
                ))}
              </select>
            </label>
            <div className="merge-compare-view">
              <ScriptDiffView docA={(docA ?? { type: 'doc', content: [] }) as JSONContent}
                docB={docB as JSONContent} labelA={labelA} labelB={labelB} />
            </div>
          </div>
        )}

        <footer className="merge-footer">
          {error && <p className="merge-error" role="alert">{error}</p>}
          {allowWhole && (
            <div className="merge-whole">
              <button type="button" className="merge-secondary" disabled={busy}
                onClick={() => void resolve({ kind: 'device' })}>{t('merge.keepDeviceWhole')}</button>
              <button type="button" className="merge-secondary" disabled={busy}
                onClick={() => void resolve({ kind: 'cloud' })}>{t('merge.keepCloudWhole')}</button>
              <span className="merge-whole-note">{t('merge.wholeNote')}</span>
            </div>
          )}
          <div className="merge-primary-row">
            {remaining > 0 && <span className="merge-remaining">{t('merge.remaining', { count: remaining })}</span>}
            <button type="button" className="merge-primary" disabled={busy || remaining > 0 || result.identical && !allowWhole}
              onClick={() => void resolve({ kind: 'merged', content: merged })}>
              {busy ? t('merge.saving') : t('merge.saveMerged')}
            </button>
          </div>
        </footer>
      </div>
    </ModalOverlay>
  );
}
