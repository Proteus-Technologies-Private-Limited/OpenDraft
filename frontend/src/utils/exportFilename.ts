/**
 * The name an exported file is offered under.
 *
 * A screenplay's title is its filename, and a title is not necessarily Latin.
 * The exporters used to keep only `[a-zA-Z0-9_- ]`, which meant a script titled
 * in Cyrillic — or Greek, or Hindi, or with an accent on it — was saved as
 * "Untitled.pdf" with the writer's own title thrown away.
 *
 * So this removes only what a filesystem actually objects to: the path
 * separators, the characters Windows reserves, control codes, and the leading
 * or trailing punctuation that would make a hidden or unopenable file.
 */
export function sanitizeExportFilename(name: string): string {
  const cleaned = (name || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '') // a leading dot hides the file — and "." and ".." are not names
    .replace(/[. ]+$/, ''); // Windows silently drops trailing dots and spaces
  // Filesystems cap a name at 255 bytes; leave room for the extension.
  return cleaned.slice(0, 120).trim() || 'Untitled';
}
