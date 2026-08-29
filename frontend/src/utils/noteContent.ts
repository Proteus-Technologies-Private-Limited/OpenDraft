/**
 * What the text of a script note *means*.
 *
 * A note body is free-form text with conventions layered on it: a bare image
 * URL on its own line is a picture, a YouTube link is a video, `@AssetName`
 * points at the project's Asset Manager, and anything else is prose with
 * clickable URLs in it. Those rules used to live inside the panel's renderer,
 * which was fine while the panel was the only thing that read a note.
 *
 * A note that prints is read by four more things — the line-count that reserves
 * room for it on the page, the block drawn on screen, the PDF and the Word
 * export — and if any of them disagreed about what a line means, the space
 * reserved would not match the space drawn. So the interpretation happens once,
 * here, and everything else renders the result.
 *
 * Deliberately free of React, stores and services so it is testable in the node
 * environment: the caller passes in the assets and a URL resolver.
 */

/** The subset of an Asset this module needs. `Asset` satisfies it structurally. */
export interface NoteAsset {
  id: string;
  original_name: string;
  mime_type: string;
}

export interface NoteRenderContext {
  assets: readonly NoteAsset[];
  /**
   * Resolve an asset to a URL. Returns null when it cannot be — a document
   * opened without its project, for instance — and the reference then falls
   * back to its literal `@Name` text rather than silently printing nothing.
   */
  assetUrl?: (asset: NoteAsset) => string | null;
}

/** A run within a line of note prose. */
export type NoteInline =
  | { kind: 'text'; text: string }
  | { kind: 'url'; url: string }
  | { kind: 'asset'; ref: string; asset: NoteAsset | null; url: string | null; isImage: boolean };

/** A block of note content. Blocks stack; inlines flow. */
export type NoteBlock =
  | { kind: 'line'; parts: NoteInline[] }
  | { kind: 'image'; url: string; alt: string }
  /** A video: playable on screen where it can be, its URL in print. */
  | { kind: 'video'; url: string; embedUrl: string | null };

/** Does this string look like an image URL? */
export const isImageUrl = (url: string): boolean =>
  /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(url);

/** Does this string look like a video URL or a known video host? */
export const isVideoUrl = (url: string): boolean =>
  /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url) ||
  /youtube\.com\/watch|youtu\.be\/|vimeo\.com\//i.test(url);

/** The embeddable form of a YouTube/Vimeo URL, or null if it is neither. */
export const toEmbedUrl = (url: string): string | null => {
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  m = url.match(/vimeo\.com\/(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return null;
};

const HTTP_RE = /^https?:\/\//;
const URL_SPLIT_RE = /(https?:\/\/[^\s]+)/g;

/** Find the asset a `@Name` reference points at, matching the panel's rules. */
function findAsset(name: string, assets: readonly NoteAsset[]): NoteAsset | null {
  const wanted = name.toLowerCase();
  return (
    assets.find(
      (a) =>
        a.original_name.toLowerCase() === wanted ||
        a.original_name.replace(/\s+/g, '_').toLowerCase() === wanted,
    ) ?? null
  );
}

function parseInlines(line: string, ctx: NoteRenderContext): NoteInline[] {
  const parts: NoteInline[] = [];
  for (const chunk of line.split(/(@\S+)/g)) {
    if (!chunk) continue;
    if (chunk.startsWith('@')) {
      const asset = findAsset(chunk.slice(1), ctx.assets);
      parts.push({
        kind: 'asset',
        ref: chunk,
        asset,
        url: asset ? (ctx.assetUrl?.(asset) ?? null) : null,
        isImage: !!asset && asset.mime_type.startsWith('image/'),
      });
      continue;
    }
    // Plain prose, with any bare URLs pulled out so they can be made clickable.
    for (const piece of chunk.split(URL_SPLIT_RE)) {
      if (!piece) continue;
      if (HTTP_RE.test(piece)) parts.push({ kind: 'url', url: piece });
      else parts.push({ kind: 'text', text: piece });
    }
  }
  return parts;
}

/**
 * Interpret a note body. One line of source becomes one block, except that a
 * line which is nothing but a picture becomes a picture.
 */
export function parseNoteContent(content: string, ctx: NoteRenderContext): NoteBlock[] {
  if (!content) return [];
  const blocks: NoteBlock[] = [];

  for (const raw of content.split('\n')) {
    const line = raw.trim();

    if (HTTP_RE.test(line) && isImageUrl(line)) {
      blocks.push({ kind: 'image', url: line, alt: '' });
      continue;
    }
    if (HTTP_RE.test(line) && isVideoUrl(line)) {
      blocks.push({ kind: 'video', url: line, embedUrl: toEmbedUrl(line) });
      continue;
    }

    const parts = parseInlines(line, ctx);
    // An asset reference alone on its line, pointing at a picture, is a
    // picture — the same way a bare image URL is. Anywhere else it stays
    // inline, because a thumbnail mid-sentence is not a figure.
    if (parts.length === 1 && parts[0].kind === 'asset' && parts[0].isImage && parts[0].url) {
      blocks.push({ kind: 'image', url: parts[0].url, alt: parts[0].asset?.original_name ?? '' });
      continue;
    }
    blocks.push({ kind: 'line', parts });
  }

  return blocks;
}

/** What an inline run reads as on paper. */
function inlineText(part: NoteInline): string {
  switch (part.kind) {
    case 'text': return part.text;
    case 'url': return part.url;
    // An unresolved reference prints as what the writer typed, which is at
    // least visible, rather than vanishing.
    case 'asset': return part.asset ? part.asset.original_name : part.ref;
  }
}

/**
 * The printed text of a block. An image has none — it is measured by its
 * height instead — and a video degrades to its URL, because a printed page
 * cannot play anything.
 */
export function noteBlockText(block: NoteBlock): string {
  switch (block.kind) {
    case 'line': return block.parts.map(inlineText).join('');
    case 'image': return '';
    case 'video': return block.url;
  }
}

/** The whole note as it would print, one line per block. */
export function noteContentText(blocks: readonly NoteBlock[]): string {
  return blocks.map(noteBlockText).join('\n');
}
