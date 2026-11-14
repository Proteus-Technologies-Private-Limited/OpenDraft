import { focusWithoutKeyboard, nativeKeyboardVisible } from './softKeyboard';

/** Reparent a portal without remounting it. moveBefore preserves focus and
 * selection natively; older web views need those restored after appendChild.
 *
 * That restoring focus() raises Android's keyboard, so folding, unfolding or
 * turning the device with the writing pad focused opened a keyboard the writer
 * had closed. Where the app can tell the keyboard was down, the caret comes
 * back without it; a keyboard that was up stays up. */
export function movePanelHost(host: HTMLElement, target: HTMLElement): void {
  if (host.parentElement === target) return;
  const movable = target as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void };
  if (movable.moveBefore && host.isConnected && target.isConnected) {
    movable.moveBefore(host, null);
    return;
  }
  const focused = document.activeElement instanceof HTMLElement && host.contains(document.activeElement)
    ? document.activeElement : null;
  const field = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement ? focused : null;
  const start = field?.selectionStart;
  const end = field?.selectionEnd;
  const direction = field?.selectionDirection;
  const selection = window.getSelection();
  // Inputs own their selection separately from the document selection.
  const range = !field && selection?.rangeCount && host.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
  // Read before the move: losing focus during it can take the keyboard down.
  const keyboardWasDown = focused ? nativeKeyboardVisible() === false : false;
  target.appendChild(host);
  if (focused && keyboardWasDown) focusWithoutKeyboard(focused);
  else focused?.focus({ preventScroll: true });
  if (field && start != null && end != null) field.setSelectionRange(start, end, direction ?? undefined);
  if (selection && range) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
