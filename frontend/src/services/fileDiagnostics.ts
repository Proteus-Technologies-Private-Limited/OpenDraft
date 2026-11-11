/** One bounded, in-memory failure. Never retain file bytes or IPC arguments. */
export type FileStage = 'dialog' | 'validation' | 'destination' | 'staging' | 'backup'
  | 'replacement' | 'cleanup' | 'native-write' | 'share' | 'download';

export interface FileOperationContext {
  operation: 'export' | 'save-in-place';
  format: string;
  stage: FileStage;
  command?: string;
}

export interface FileFailure extends FileOperationContext {
  occurredAt: string;
  message: string;
}

let lastFailure: FileFailure | null = null;

export function fileFormat(name: string): string {
  const filename = name.split(/[/\\]/).pop() ?? '';
  const dot = filename.lastIndexOf('.');
  const extension = filename.slice(dot + 1).toLowerCase();
  return dot > 0 && /^[a-z0-9]{1,12}$/.test(extension) ? extension : 'unknown';
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error) ?? String(error); }
  catch { return String(error); }
}

export async function withFileDiagnostics<T>(context: FileOperationContext, operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = errorText(error).slice(0, 2048);
    // These prefixes come from safe_file.rs, never guesses based on OS codes.
    const nativeStage = /^Save failed during (destination|staging|backup|replacement|cleanup):/.exec(message)?.[1] as FileStage | undefined;
    lastFailure = {
      operation: context.operation, format: context.format, stage: nativeStage ?? context.stage,
      ...(context.command ? { command: context.command } : {}),
      occurredAt: new Date().toISOString(), message,
    };
    throw error;
  }
}

export function getLastFileFailure(): FileFailure | null {
  return lastFailure ? { ...lastFailure } : null;
}

/** Diagnostic data uses stable English field names, like the existing report. */
export function formatFileFailure(failure: FileFailure): string {
  return [
    `Time: ${failure.occurredAt}`,
    `Operation: ${failure.operation}`,
    `Format: ${failure.format}`,
    `Stage: ${failure.stage}`,
    ...(failure.command ? [`Command: ${failure.command}`] : []),
    `Error: ${failure.message}`,
  ].join('\n');
}
