/**
 * How tall a screenplay image is, in 12-point lines.
 *
 * One formula for every place that needs it: the editor's image NodeView
 * (first load and corner resize), the Title Page dialog, which has to know an
 * image's real height before the image ever reaches the document, and the PDF
 * title page, which must advance by the same number of lines the editor and
 * the paginator count.
 */
import { t } from '../i18n';

/** One 12pt line at 96 CSS px per inch — matches pagination's LINE_HEIGHT_PT. */
export const IMAGE_LINE_HEIGHT_PX = 16;

/** Points per CSS pixel. */
export const PT_PER_PX = 0.75;

/** Lines an image of `widthPx` and `aspect` (height / width) occupies, its
 *  margins included (the +1). */
export function imageHeightLines(widthPx: number, aspect: number): number {
  const lines = Math.ceil((widthPx * aspect) / IMAGE_LINE_HEIGHT_PX) + 1;
  return Number.isFinite(lines) ? Math.max(1, lines) : 1;
}

/**
 * The width and line count the NodeView settles on when it first shows an
 * image: its stored width, or its natural width capped at 90% of the column.
 */
export function naturalImageLayout(
  naturalWidth: number,
  naturalHeight: number,
  columnWidthPx: number,
  storedWidth?: number | null,
): { width: number; heightLines: number } {
  const naturalW = naturalWidth || 300;
  const width = storedWidth && storedWidth > 0 ? storedWidth : Math.min(naturalW, Math.round(columnWidthPx * 0.9));
  return { width, heightLines: imageHeightLines(width, naturalHeight / (naturalWidth || 1)) };
}

/** The natural pixel size of an image file, read by decoding it. */
export function readImageFileSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch (err) {
      reject(new Error(t('format:titlePage.imageUnreadable'), { cause: err }));
      return;
    }
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      } else {
        reject(new Error(t('format:titlePage.imageUnreadable')));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t('format:titlePage.imageUnreadable')));
    };
    img.src = url;
  });
}

/**
 * The `width` / `heightLines` attributes a newly chosen image would get from
 * the NodeView in a column `columnWidthPx` wide. Measured up front so a page
 * laid out before the image is displayed already uses its real height.
 */
export async function measureImageFile(
  file: Blob,
  columnWidthPx: number,
): Promise<{ width: number; heightLines: number }> {
  const { width, height } = await readImageFileSize(file);
  return naturalImageLayout(width, height, columnWidthPx);
}
