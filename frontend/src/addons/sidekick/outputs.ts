/**
 * The Sidekick in core's own flows: a report in Tools → Analytics → Reports
 * (which brings CSV and PDF export with it), a Markdown export under
 * File → Export, and keyboard shortcuts as an editor extension.
 *
 * The shortcuts extension adds no nodes or marks — only key bindings — so a
 * script never depends on the Sidekick being installed to open.
 */
import { Extension } from '@tiptap/core';
import { pluginRegistry, type PluginExporter, type PluginReport, type ReportTable } from '../../plugins/registry';
import { readData } from './data';
import { DEFAULT_KEEP_TYPE_ID, DEFAULT_TYPE_ID, findType, isPending, PLUGIN_ID, type SidekickData, type Task } from './model';
import { fileSelectionWithFeedback, tr, typeLabel } from './actions';
import { sidekickScriptPlugin } from './script';

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export function buildReport(data: SidekickData, title: string): ReportTable {
  const pending = data.tasks.filter(isPending).length;
  return {
    title: tr('report.title', { title: title || 'Untitled' }),
    summary: tr('report.summary', { pending, closed: data.tasks.length - pending, total: data.tasks.length }),
    columns: [tr('report.type'), tr('report.kind'), tr('report.subject'), tr('report.status'), tr('report.scene'), tr('report.excerpt'), tr('report.note'), tr('report.filed')],
    rows: data.tasks.map((task) => {
      const type = findType(data, task.typeId);
      return [
        type ? typeLabel(type) : tr('panel.other'),
        tr(`kind.${type?.kind ?? 'track'}`),
        task.subject,
        tr(`status.${task.status}`),
        task.source.sceneHeading ?? '',
        clip(oneLine(task.excerpt.text), 160),
        oneLine(task.note),
        task.createdAt.slice(0, 10),
      ];
    }),
  };
}

export const report: PluginReport = {
  id: 'od-sidekick-tasks',
  label: 'Sidekick tasks', // i18n-ignore: fallback for report.label
  labelKey: `${PLUGIN_ID}:report.label`,
  get description() { return tr('report.description'); },
  build: ({ title }) => buildReport(readData(), title),
};

/** Markdown that reads well on its own and as a GitHub/Notion checklist. */
export function toMarkdown(data: SidekickData, title: string): string {
  const out: string[] = [`# ${title || 'Untitled'} — Sidekick`, ''];
  const byType = new Map<string, Task[]>();
  for (const task of data.tasks) byType.set(task.typeId, [...(byType.get(task.typeId) ?? []), task]);
  for (const [typeId, tasks] of byType) {
    const type = findType(data, typeId);
    out.push(`## ${type ? typeLabel(type) : tr('panel.other')}`, '');
    for (const task of tasks) {
      const box = type?.kind === 'keep' ? '-' : `- [${task.status === 'done' ? 'x' : ' '}]`;
      const where = task.source.sceneHeading ? ` — *${task.source.sceneHeading}*` : '';
      const status = type?.kind === 'keep' || task.status === 'in-progress' ? ` (${tr(`status.${task.status}`)})` : '';
      out.push(`${box} **${task.subject.replace(/\*/g, '\\*')}**${status}${where}`);
      if (task.excerpt.text) for (const line of task.excerpt.text.split('\n')) out.push(`  > ${line}`);
      if (task.note.trim()) out.push('', `  ${oneLine(task.note)}`);
      out.push('');
    }
  }
  if (data.tasks.length === 0) out.push(tr('panel.empty'), '');
  return out.join('\n');
}

export const exporter: PluginExporter = {
  id: 'od-sidekick-markdown',
  label: 'Sidekick Tasks (.md)', // i18n-ignore: fallback for export.label
  labelKey: `${PLUGIN_ID}:export.label`,
  extension: 'md',
  filterName: 'Markdown',
  export: async ({ title }) => toMarkdown(readData(), title),
};

/** Mod-Alt-T files the selection as a To Do; Mod-Alt-K holds it for later. */
export const SidekickShortcuts = Extension.create({
  name: 'odSidekickShortcuts',
  addProseMirrorPlugins() {
    return [sidekickScriptPlugin];
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-t': () => pluginRegistry.isActive(PLUGIN_ID) && fileSelectionWithFeedback(this.editor, DEFAULT_TYPE_ID),
      'Mod-Alt-k': () => pluginRegistry.isActive(PLUGIN_ID) && fileSelectionWithFeedback(this.editor, DEFAULT_KEEP_TYPE_ID),
    };
  },
});
