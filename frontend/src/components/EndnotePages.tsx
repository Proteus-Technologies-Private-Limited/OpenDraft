/**
 * The NOTES sheets appended to the end of a script in endnote mode.
 *
 * Endnotes are not part of the ProseMirror document — they are assembled from
 * the notes store — so the paginator cannot lay them out the way it lays out
 * script. Instead they are drawn as synthetic pages after the last real one,
 * inside the same continuous `.page` element, reusing the page-break markup so
 * a reader cannot tell them from a real break.
 *
 * Their heights are arithmetic rather than measured: each page is
 * `sepHeightPx + pageContentPx` tall, the same numbers the paginator used to
 * pack them, so nothing here has to read the DOM back.
 */
import React from 'react';
import type { PageLayout } from '../stores/editorStore';
import { getPageMetrics } from '../editor/pagination';
import type { EndnotePage, FootnotePlan } from '../utils/footnotes';
import { noteEntryLabel } from '../utils/noteNumbering';
import { NoteBody } from './FootnoteBlock';

/** Height of one printed line, in px. Matches pagination's LINE_HEIGHT_PT. */
const LINE_PX = 16;

interface EndnotePagesProps {
  plan: FootnotePlan;
  pages: readonly EndnotePage[];
  layout: PageLayout;
  /** Bottom of the last script page, in the page's own coordinate space. */
  lastPageEnd: number;
  /** Header and footer bands, drawn exactly as a real break draws them. */
  renderBands: (pageNumber: number) => { header: React.ReactNode; footer: React.ReactNode };
  /** Script pages before these, so the first endnote sheet numbers correctly. */
  scriptPageCount: number;
}

const EndnotePages: React.FC<EndnotePagesProps> = ({
  plan, pages, layout, lastPageEnd, renderBands, scriptPageCount,
}) => {
  const m = getPageMetrics(layout);
  const pitch = m.sepHeightPx + m.pageContentPx;

  return (
    <>
      {pages.map((page, k) => {
        // The break that opens this sheet, and the sheet's own content box.
        const breakTop = lastPageEnd + k * pitch;
        const contentTop = breakTop + m.sepHeightPx;
        const pageNumber = scriptPageCount + k + 1;
        const bands = renderBands(pageNumber);

        return (
          <React.Fragment key={`endnote-${k}`}>
            <div className="page-sep" style={{ top: `${breakTop}px` }}>
              <div
                className="page-sep-bottom"
                style={{ height: `${layout.bottomMargin}pt`, position: 'relative' }}
              >
                {bands.footer}
              </div>
              <div className="page-sep-gap" />
              <div className="page-sep-top" style={{ height: `${layout.topMargin}pt` }}>
                {bands.header}
              </div>
            </div>

            <div
              className="endnote-page"
              style={{ top: `${contentTop}px`, height: `${m.pageContentPx}px` }}
            >
              {page.hasHeading && <div className="endnote-heading">NOTES</div>}
              {page.slices.map((slice, i) => {
                const entry = plan.entryById.get(slice.noteId);
                if (!entry) return null;
                // Clipped to this sheet's share, so a note longer than a page
                // continues on the next rather than running off the bottom.
                // A continuation does not repeat its number, as in Word.
                return (
                  <div
                    className="footnote-slice"
                    key={`${slice.noteId}-${slice.fromLine}-${i}`}
                    style={{ height: slice.lines * LINE_PX, cursor: 'default' }}
                  >
                    <div className="footnote-slice-inner" style={{ marginTop: -slice.fromLine * LINE_PX }}>
                      <NoteBody
                        entry={entry}
                        label={slice.isStart ? noteEntryLabel(entry.number, plan.settings.numberFormat) : null}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
};

export default EndnotePages;
