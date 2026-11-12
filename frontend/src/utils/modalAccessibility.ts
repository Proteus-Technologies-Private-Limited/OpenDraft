/** Shared focus scopes for custom overlays. Native <dialog> keeps its own scope. */
const layers: HTMLElement[] = [];
const listeners = new Set<() => void>();
const blocked = new Map<HTMLElement, { inert: boolean; hidden: string | null }>();

export function modalPortalContainer(): HTMLElement {
  const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  const native = dialogs[dialogs.length - 1];
  const custom = layers[layers.length - 1];
  // Registered scopes follow opening order, which may differ from DOM order.
  return native && !layers.includes(native) && (!custom || !native.contains(custom))
    ? native : custom ?? native ?? document.body;
}

export function subscribeModalLayers(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function reconcile() {
  for (const [element, original] of blocked) {
    element.inert = original.inert;
    if (original.hidden === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', original.hidden);
  }
  blocked.clear();
  // Move persistent popup/live-region hosts before deciding which siblings
  // belong to the background; a host moved into the modal must not stay inert.
  listeners.forEach(listener => listener());
  const active = layers[layers.length - 1];
  if (active) {
    let branch: HTMLElement = active;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (!(sibling instanceof HTMLElement) || sibling === branch || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) continue;
        blocked.set(sibling, { inert: sibling.inert, hidden: sibling.getAttribute('aria-hidden') });
        sibling.inert = true;
        sibling.setAttribute('aria-hidden', 'true');
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
  }
}

export function registerModal(element: HTMLElement): () => void {
  // Children mount before parents: an already registered nested scope stays on top.
  const child = layers.findIndex(layer => element.contains(layer));
  layers.splice(child < 0 ? layers.length : child, 0, element);
  reconcile();
  return () => {
    const index = layers.indexOf(element);
    if (index >= 0) layers.splice(index, 1);
    reconcile();
  };
}

export function isTopModal(element: HTMLElement): boolean {
  return modalPortalContainer() === element;
}

export function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, a[href], [tabindex], [contenteditable="true"]',
  )).filter(element => element.tabIndex >= 0 && !element.matches(':disabled') &&
    !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
    element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
}
