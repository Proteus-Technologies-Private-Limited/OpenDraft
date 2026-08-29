/**
 * The footnote plan an exporter needs, built from the document being written
 * out rather than from the live editor.
 *
 * Exporters take TipTap JSON, where the `scriptNote` marks sit on text nodes,
 * so they can build the plan themselves. Asset URLs are resolved through the
 * same project the panel uses; without one the reference falls back to its
 * literal text rather than printing nothing at all.
 */
import type { JSONContent } from '@tiptap/react';
import type { GeneralNote, NoteInfo, PageLayout } from '../stores/editorStore';
import { useAssetStore } from '../stores/assetStore';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../services/api';
import { buildFootnotePlan, type FootnotePlan } from './footnotes';

export function buildExportFootnotePlan(
  doc: JSONContent,
  layout: PageLayout,
  notes: readonly NoteInfo[],
  generalNotes: readonly GeneralNote[] = [],
): FootnotePlan | null {
  try {
    const assets = useAssetStore.getState().assets;
    const projectId = useProjectStore.getState().currentProject?.id ?? null;
    return buildFootnotePlan(doc, layout, notes, {
      assets,
      assetUrl: (a) => (projectId ? api.getAssetUrl(projectId, a.id) : null),
    }, generalNotes);
  } catch (err) {
    // An export must never fail because the notes could not be read.
    console.warn('[footnotes] could not build the plan for export', err);
    return null;
  }
}
