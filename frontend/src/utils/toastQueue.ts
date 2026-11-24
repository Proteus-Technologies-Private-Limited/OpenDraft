/** How the toast stack changes; kept apart from the component so it can be tested. */
export interface QueuedToast { id: number; text: string; type: 'error' | 'success' | 'info' }

/** The same message again replaces the one already shown rather than stacking a copy. */
export function addToast<T extends QueuedToast>(list: T[], message: T): T[] {
  return [...list.filter(item => item.text !== message.text || item.type !== message.type), message];
}

/** Errors raised for the previous account or connection no longer apply. */
export function withoutErrors<T extends QueuedToast>(list: T[]): T[] {
  return list.filter(item => item.type !== 'error');
}
