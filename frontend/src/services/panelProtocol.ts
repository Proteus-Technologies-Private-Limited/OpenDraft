/** Read-only scene summaries. No document JSON, file paths or editor instances cross windows. */
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Appearance } from '../utils/appearance';
import { isAppearance } from '../utils/appearance';
import { languageInfo } from '../i18n/languages';

export interface PanelScene { heading: string; synopsis: string; number: string; color: string }
export interface NavigatorSnapshot {
  session: string;
  revision: number;
  sequence: number;
  title: string;
  scenes: PanelScene[];
  active: number;
  appearance: Appearance;
  language: string;
}
export type PanelAction = { kind: 'ready' } | { kind: 'navigate'; revision: number; index: number };
export interface PanelMessage { session: string; action: PanelAction }

export function sceneSummary(doc: PMNode, selection: number): { scenes: PanelScene[]; positions: number[]; active: number } {
  const scenes: PanelScene[] = [], positions: number[] = [];
  let active = -1;
  doc.descendants((node, pos) => {
    if (node.type.name !== 'sceneHeading') return !node.isTextblock;
    if (pos <= selection) active = scenes.length;
    positions.push(pos + 1);
    scenes.push({ heading: node.textContent, synopsis: String(node.attrs.synopsis || ''), number: String(node.attrs.sceneNumber ?? scenes.length + 1), color: /^#[\da-f]{6}$/i.test(node.attrs.sceneColor) ? node.attrs.sceneColor : '' });
    return false;
  });
  return { scenes, positions, active };
}

export function isSnapshot(value: unknown): value is NavigatorSnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as NavigatorSnapshot;
  return typeof s.session === 'string' && Number.isSafeInteger(s.revision) && s.revision >= 0
    && Number.isSafeInteger(s.sequence) && s.sequence >= 0 && typeof s.title === 'string'
    && isAppearance(s.appearance) && typeof s.language === 'string' && languageInfo(s.language).code === s.language
    && Number.isInteger(s.active) && Array.isArray(s.scenes) && s.active >= -1 && s.active < s.scenes.length
    && s.scenes.every(scene => scene && ['heading', 'synopsis', 'number', 'color'].every(key => typeof scene[key as keyof PanelScene] === 'string'));
}

export function navigationPosition(message: PanelMessage, session: string, revision: number, positions: number[]): number | null {
  const action = message?.action;
  if (message?.session !== session || action?.kind !== 'navigate' || action.revision !== revision
    || !Number.isInteger(action.index) || action.index < 0 || action.index >= positions.length) return null;
  return positions[action.index];
}
