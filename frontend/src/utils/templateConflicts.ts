/**
 * Template conflict detection and resolution utilities.
 *
 * When applying a template to an existing document, detects:
 * 1. Disabled element types that exist in the document
 * 2. Inline marks that conflict with locked formatting in enforce mode
 *
 * Provides resolution via a single ProseMirror transaction.
 */

import type { Editor } from '@tiptap/core';
import type { FormattingTemplate } from '../stores/formattingTypes';
import { BUILT_IN_ELEMENT_IDS } from '../stores/formattingTypes';
import { getLockedFormatting } from './effectiveFormatting';
import type { LockedFormatting } from './effectiveFormatting';

// ── Type definitions ──

export interface DisabledElementConflict {
  elementType: string;
  elementLabel: string;
  nodeCount: number;
  replacementType: string;
}

export interface FormattingViolation {
  elementType: string;
  elementLabel: string;
  conflictingMarks: string[];
  nodeCount: number;
  shouldReformat: boolean;
}

export interface TemplateConflicts {
  disabledElements: DisabledElementConflict[];
  formattingViolations: FormattingViolation[];
  hasConflicts: boolean;
}

// ── Default replacements ──

const DEFAULT_REPLACEMENTS: Record<string, string> = {
  lyrics: 'dialogue',
  castList: 'general',
  shot: 'action',
  showEpisode: 'general',
  newAct: 'sceneHeading',
  endOfAct: 'action',
};

export function getDefaultReplacement(elementType: string): string {
  return DEFAULT_REPLACEMENTS[elementType] || 'action';
}

// ── Enabled element options for dropdowns ──

export function getEnabledElementOptions(
  template: FormattingTemplate,
): Array<{ id: string; label: string }> {
  return Object.values(template.rules)
    .filter((r) => r.enabled)
    .map((r) => ({ id: r.id, label: r.label }));
}

// ── Helper: get element type id from a block node ──

function getElementTypeId(node: any): string | null {
  if (node.type.name === 'customElement') {
    return node.attrs?.customTypeId || null;
  }
  if (BUILT_IN_ELEMENT_IDS.includes(node.type.name)) {
    return node.type.name;
  }
  return null;
}

// ── Mark name to human-readable label ──

const MARK_LABELS: Record<string, string> = {
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strike: 'Strikethrough',
  subscript: 'Subscript',
  superscript: 'Superscript',
  textStyle: 'Font/Size',
  color: 'Text Color',
  highlight: 'Highlight',
  formatOverride: 'Format Override',
};

// ── Map mark type name to LockedFormatting key ──

function isMarkLocked(markName: string, locked: LockedFormatting): boolean {
  switch (markName) {
    case 'bold': return locked.bold;
    case 'italic': return locked.italic;
    case 'underline': return locked.underline;
    case 'strike': return locked.strikethrough;
    case 'subscript': return locked.subscript;
    case 'superscript': return locked.superscript;
    case 'textStyle': return locked.fontFamily || locked.fontSize;
    case 'color': return locked.textColor;
    case 'highlight': return locked.backgroundColor;
    case 'formatOverride': return true; // always stale when switching templates
    default: return false;
  }
}

// ── Detection ──

export function detectTemplateConflicts(
  editor: Editor,
  template: FormattingTemplate,
): TemplateConflicts {
  const isEnforce = template.mode === 'enforce';

  // Build set of disabled element types
  const disabledSet = new Set<string>();
  for (const [id, rule] of Object.entries(template.rules)) {
    if (!rule.enabled) disabledSet.add(id);
  }

  // Build locked formatting per element type
  const lockedMap = new Map<string, LockedFormatting>();
  if (isEnforce) {
    for (const [id, rule] of Object.entries(template.rules)) {
      if (rule.enabled) {
        lockedMap.set(id, getLockedFormatting(rule, true));
      }
    }
  }

  // Accumulators
  const disabledCounts = new Map<string, { label: string; count: number }>();
  const violationMap = new Map<string, { label: string; marks: Set<string>; count: number }>();

  // Get enabled element options for default replacement validation
  const enabledIds = new Set(
    Object.values(template.rules).filter((r) => r.enabled).map((r) => r.id),
  );

  editor.state.doc.descendants((node, _pos) => {
    if (!node.isBlock) return;

    const typeId = getElementTypeId(node);
    if (!typeId) return;

    // Check 1: disabled element type
    if (disabledSet.has(typeId) || (!template.rules[typeId] && node.type.name !== 'doc')) {
      // Element type is disabled or not in template at all
      const existing = disabledCounts.get(typeId);
      const label = template.rules[typeId]?.label
        || (node.type.name === 'customElement' ? (node.attrs?.customLabel || typeId) : typeId);
      if (existing) {
        existing.count++;
      } else {
        disabledCounts.set(typeId, { label, count: 1 });
      }
      return; // no need to check formatting on disabled elements
    }

    // Check 2: formatting violations (enforce mode only)
    if (!isEnforce) return;
    const locked = lockedMap.get(typeId);
    if (!locked) return;

    // Scan text children for conflicting marks
    let hasViolation = false;
    const conflictingMarks = new Set<string>();

    node.descendants((child: any) => {
      if (!child.isText || !child.marks || child.marks.length === 0) return;
      for (const mark of child.marks) {
        const markName = mark.type.name;
        if (isMarkLocked(markName, locked)) {
          conflictingMarks.add(markName);
          hasViolation = true;
        }
      }
    });

    if (hasViolation) {
      const existing = violationMap.get(typeId);
      const label = template.rules[typeId]?.label || typeId;
      if (existing) {
        existing.count++;
        for (const m of conflictingMarks) existing.marks.add(m);
      } else {
        violationMap.set(typeId, { label, marks: conflictingMarks, count: 1 });
      }
    }
  });

  // Convert to arrays
  const disabledElements: DisabledElementConflict[] = [];
  for (const [typeId, { label, count }] of disabledCounts) {
    let replacement = getDefaultReplacement(typeId);
    if (!enabledIds.has(replacement)) {
      replacement = enabledIds.values().next().value || 'action';
    }
    disabledElements.push({
      elementType: typeId,
      elementLabel: label,
      nodeCount: count,
      replacementType: replacement,
    });
  }

  const formattingViolations: FormattingViolation[] = [];
  for (const [typeId, { label, marks, count }] of violationMap) {
    formattingViolations.push({
      elementType: typeId,
      elementLabel: label,
      conflictingMarks: [...marks].map((m) => MARK_LABELS[m] || m),
      nodeCount: count,
      shouldReformat: true,
    });
  }

  return {
    disabledElements,
    formattingViolations,
    hasConflicts: disabledElements.length > 0 || formattingViolations.length > 0,
  };
}

// ── Resolution ──

export function resolveTemplateConflicts(
  editor: Editor,
  template: FormattingTemplate,
  conflicts: TemplateConflicts,
): void {
  const { tr } = editor.state;
  const isEnforce = template.mode === 'enforce';

  // Build lookup maps
  const replacementMap = new Map<string, string>();
  for (const c of conflicts.disabledElements) {
    replacementMap.set(c.elementType, c.replacementType);
  }

  const reformatSet = new Set<string>();
  for (const v of conflicts.formattingViolations) {
    if (v.shouldReformat) reformatSet.add(v.elementType);
  }

  // Build locked formatting per element type for mark removal
  const lockedMap = new Map<string, LockedFormatting>();
  if (isEnforce) {
    for (const [id, rule] of Object.entries(template.rules)) {
      if (rule.enabled) {
        lockedMap.set(id, getLockedFormatting(rule, true));
      }
    }
  }

  // Collect node positions (iterate forward, apply in reverse for stability)
  const nodeOps: Array<{
    pos: number;
    node: any;
    typeId: string;
    action: 'replace' | 'reformat' | 'both';
    replacementType?: string;
  }> = [];

  editor.state.doc.descendants((node, pos) => {
    if (!node.isBlock) return;
    const typeId = getElementTypeId(node);
    if (!typeId) return;

    const needsReplace = replacementMap.has(typeId);
    const needsReformat = reformatSet.has(typeId);

    if (needsReplace && needsReformat) {
      nodeOps.push({ pos, node, typeId, action: 'both', replacementType: replacementMap.get(typeId) });
    } else if (needsReplace) {
      nodeOps.push({ pos, node, typeId, action: 'replace', replacementType: replacementMap.get(typeId) });
    } else if (needsReformat) {
      nodeOps.push({ pos, node, typeId, action: 'reformat' });
    }
  });

  // Apply in reverse order to keep positions stable
  for (let i = nodeOps.length - 1; i >= 0; i--) {
    const op = nodeOps[i];

    // Pass 1: Node type change
    if (op.action === 'replace' || op.action === 'both') {
      const repType = op.replacementType!;
      if (BUILT_IN_ELEMENT_IDS.includes(repType)) {
        const newNodeType = editor.schema.nodes[repType];
        if (newNodeType) {
          tr.setNodeMarkup(op.pos, newNodeType, {});
        }
      } else {
        // Custom element replacement
        const rule = template.rules[repType];
        const newNodeType = editor.schema.nodes['customElement'];
        if (newNodeType && rule) {
          tr.setNodeMarkup(op.pos, newNodeType, {
            customTypeId: repType,
            customLabel: rule.label,
          });
        }
      }
    }

    // Pass 2: Mark removal
    if (op.action === 'reformat' || op.action === 'both') {
      const effectiveTypeId = (op.action === 'both') ? op.replacementType! : op.typeId;
      const locked = lockedMap.get(effectiveTypeId);
      if (!locked) continue;

      const from = op.pos + 1; // inside the node
      const to = op.pos + op.node.nodeSize - 1;
      if (from >= to) continue;

      // Remove conflicting marks
      const markNames = ['bold', 'italic', 'underline', 'strike', 'subscript',
        'superscript', 'textStyle', 'color', 'highlight', 'formatOverride'];
      for (const markName of markNames) {
        if (isMarkLocked(markName, locked)) {
          const markType = editor.schema.marks[markName];
          if (markType) {
            tr.removeMark(from, to, markType);
          }
        }
      }
    }
  }

  if (tr.docChanged) {
    editor.view.dispatch(tr);
  }
}
