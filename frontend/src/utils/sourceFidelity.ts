export interface SourceFidelity {
  format: string;
  warnings: string[];
  uncertain: boolean;
}
/** Saved documents are untrusted input; do not carry malformed warnings into the save UI. */
export function readSourceFidelity(value: unknown): SourceFidelity | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<SourceFidelity>;
  return typeof item.format === 'string' &&
    Array.isArray(item.warnings) &&
    item.warnings.every((w) => typeof w === 'string')
    ? {
        format: item.format,
        warnings: item.warnings,
        uncertain: item.uncertain !== false,
      }
    : null;
}
