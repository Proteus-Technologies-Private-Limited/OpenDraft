import { ApiError } from '../services/api';

/**
 * Whether an error from opening a project or script says it does not exist,
 * as opposed to any other failure (offline, server error, bad data).
 *
 * Read from the error's structure, never from a substring of its message — an
 * id or a server message can contain "404" without anything being missing.
 *
 * - Web and cloud requests throw `ApiError` with the HTTP status.
 * - The local libraries (SQLite on desktop and mobile, and the file and
 *   localStorage fallbacks) throw `Error("Project not found: <id>")` or
 *   `Error("Script not found: <id>")`, with that exact prefix.
 */
export function isNotFoundError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 404;
  if (err instanceof Error) return /^(Project|Script) not found: /.test(err.message);
  return false;
}
