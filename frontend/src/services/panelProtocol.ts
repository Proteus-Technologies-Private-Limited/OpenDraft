/** Read-only scene summaries. No document JSON, file paths or editor instances cross windows. */
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Appearance } from '../utils/appearance';
import { isAppearance } from '../utils/appearance';
import { assignSceneNumbers } from '../utils/sceneNumbers';
import { languageInfo } from '../i18n/languages';

export interface PanelScene { heading: string; synopsis: string; number: string; color: string }
export interface NavigatorSnapshot {
  session: string;
  revision: number;
  sequence: number;
  sceneRevision: number;
  title: string;
  windowTitle: string;
  scenes: PanelScene[];
  active: number;
  appearance: Appearance;
  language: string;
}
export type NavigatorUpdate = Omit<NavigatorSnapshot, 'scenes'> & { scenes?: PanelScene[] };
export type PanelAction = { kind: 'ready' } | { kind: 'navigate'; sceneRevision: number; index: number };
export interface PanelMessage { session: string; action: PanelAction }

export function sceneSummary(doc: PMNode, selection: number, numbering = { visible: true, locked: true }): { scenes: PanelScene[]; positions: number[]; active: number } {
  const scenes: PanelScene[] = [], positions: number[] = [];
  let active = -1;
  doc.descendants((node, pos) => {
    if (node.type.name !== 'sceneHeading') return !node.isTextblock;
    if (pos <= selection) active = scenes.length;
    positions.push(pos + 1);
    scenes.push({ heading: node.textContent, synopsis: String(node.attrs.synopsis || ''), number: String(node.attrs.sceneNumber ?? ''), color: /^#[\da-f]{6}$/i.test(node.attrs.sceneColor) ? node.attrs.sceneColor : '' });
    return false;
  });
  const numbers = assignSceneNumbers(scenes.map(scene => scene.number || null), numbering);
  scenes.forEach((scene, index) => { scene.number = numbers[index] ?? String(index + 1); });
  return { scenes, positions, active };
}

export function sameSceneSummary(left: readonly PanelScene[], right: readonly PanelScene[]): boolean {
  return left.length === right.length && left.every((scene, index) => {
    const other = right[index];
    return scene.heading === other.heading && scene.synopsis === other.synopsis
      && scene.number === other.number && scene.color === other.color;
  });
}

export function isNavigatorUpdate(value: unknown): value is NavigatorUpdate {
  if (!value || typeof value !== 'object') return false;
  const s = value as NavigatorUpdate;
  return typeof s.session === 'string' && Number.isSafeInteger(s.revision) && s.revision >= 0
    && Number.isSafeInteger(s.sequence) && s.sequence >= 0 && Number.isSafeInteger(s.sceneRevision) && s.sceneRevision >= 0
    && typeof s.title === 'string' && typeof s.windowTitle === 'string'
    && isAppearance(s.appearance) && typeof s.language === 'string' && languageInfo(s.language).code === s.language
    && Number.isInteger(s.active) && s.active >= -1
    && (s.scenes === undefined || (Array.isArray(s.scenes) && s.active < s.scenes.length
      && s.scenes.every(scene => scene && ['heading', 'synopsis', 'number', 'color'].every(key => typeof scene[key as keyof PanelScene] === 'string'))));
}

export function navigationPosition(message: PanelMessage, session: string, sceneRevision: number, positions: number[]): number | null {
  const action = message?.action;
  if (message?.session !== session || action?.kind !== 'navigate' || action.sceneRevision !== sceneRevision
    || !Number.isInteger(action.index) || action.index < 0 || action.index >= positions.length) return null;
  return positions[action.index];
}

export function isSnapshot(value: unknown): value is NavigatorSnapshot {
  return isNavigatorUpdate(value) && value.scenes !== undefined;
}
