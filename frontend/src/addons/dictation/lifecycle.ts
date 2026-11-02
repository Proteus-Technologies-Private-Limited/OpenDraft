const cleanup = new Set<() => void>();
export function onDeactivate(callback: () => void): () => void { cleanup.add(callback); return () => { cleanup.delete(callback); }; }
export function stopDictation(): void { for (const callback of cleanup) callback(); }
