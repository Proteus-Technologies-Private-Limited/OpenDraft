/**
 * Elements that live in the document but never reach the page.
 *
 * Fountain has two of them — Sections (`#`) and Notes (`[[ ]]`) — and the spec
 * is explicit that neither is printed: they are there to outline and annotate
 * the script from inside the script. Everything that measures or renders the
 * finished page has to agree on that, or the writer sees one page count on
 * screen and gets another in the PDF.
 *
 * One list, imported by pagination, the PDF/DOCX/FDX/OSF exporters and the
 * print stylesheet's counterpart in the editor, so the four cannot drift.
 */
export const NON_PRINTING_TYPES: ReadonlySet<string> = new Set(['section', 'note']);

/** Is this node type structural — kept in the file, kept off the page? */
export function isNonPrintingType(type: string | undefined | null): boolean {
  return !!type && NON_PRINTING_TYPES.has(type);
}
