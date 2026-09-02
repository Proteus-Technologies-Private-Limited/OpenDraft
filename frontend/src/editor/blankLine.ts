/**
 * Blank-line rules for the Enter key.
 *
 * Enter on a blank line opens the element picker instead of inserting a line:
 * on a blank line, Enter is how a writer says "what comes next?". The cost is
 * that the keystroke had no way left to mean "just another blank line", so
 * consecutive blank lines could not be created at all — and at the end of a
 * script there was no populated line below to insert against either, which
 * left no workaround (issue #100).
 *
 * The rule these helpers encode: the picker asks once. Enter with nothing
 * selected in it answers "a blank line, thanks", and every Enter after that in
 * the same run keeps adding lines until the writer types or moves the caret.
 */
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';

/**
 * Element types whose leading/trailing whitespace is content rather than
 * emptiness. General exists precisely to hold text that does not follow
 * screenplay shape, so its indentation must not read as a blank line (#74).
 */
const WHITESPACE_IS_CONTENT = new Set(['general']);

/** Is this block empty as far as the Enter key is concerned? */
export function isBlankBlock(node: PMNode | null | undefined): boolean {
  if (!node || !node.isTextblock) return false;
  return WHITESPACE_IS_CONTENT.has(node.type.name)
    ? node.textContent.length === 0
    : node.textContent.trim() === '';
}

/**
 * The block immediately before the caret's own block, within the same parent.
 * Null at the start of the document — and at the start of any container
 * (an AV cell, a dual-dialogue column), which is what we want: a run of blank
 * lines does not reach across a structural boundary.
 */
export function previousSiblingBlock($from: ResolvedPos): PMNode | null {
  const depth = $from.depth;
  if (depth === 0) return null;
  const index = $from.index(depth - 1);
  if (index === 0) return null;
  return $from.node(depth - 1).child(index - 1);
}

/**
 * The element type a forced blank line should take. Callers must apply this
 * unconditionally rather than letting the split pick: ProseMirror's `splitBlock`
 * takes the *schema default* for the new node whenever the caret is at the end
 * of a block — always true on a blank one — and this document's default is
 * `sceneHeading`, so an unset blank line would come out as an empty scene
 * heading and turn up in the navigator and the scene numbering.
 *
 * A blank Action is the neutral spacer above any screenplay element, and the
 * type the Enter-at-start path already produces. Three families take something
 * else: General keeps its own type, which the writer set deliberately and whose
 * indentation an Action cannot hold (#74); title-page lines stay on the title
 * page, since an Action there ends the region the exporters recognise (#52);
 * and inside an AV cell the neutral paragraph is `avPara`, because `action` is
 * not among the children an `avCell` accepts at all.
 */
export function blankLineTypeFor(currentType: string): string {
  if (currentType === 'general' || currentType === 'titlePage') return currentType;
  if (currentType === 'customElement') return currentType;
  if (currentType === 'avPara' || currentType === 'avShot' || currentType === 'avDirection') {
    return 'avPara';
  }
  return 'action';
}
