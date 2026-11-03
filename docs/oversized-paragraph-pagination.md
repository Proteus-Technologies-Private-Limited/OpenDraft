# Oversized paragraph pagination

A paragraph taller than a complete script page can continue across pages in the editor and exported PDF. Paragraphs that fit on a complete page retain their existing pagination; they are not split to fill unused space.

Continuation fragments contain at least two visual lines. The fragmenter searches back up to four lines for a sentence ending while keeping two lines on each side; sentence endings inside a wrapped line leave a short last line and reflow the continuation. An oversized paragraph can fall back to a line boundary. Continued character speeches use the document's MORE/CONT'D settings, reserving room for both labels inside the printable area. A dialogue paragraph that fills the page also splits when its continued cue needs another line.

Visual breaks are editor decorations, not stored paragraph or hard-break nodes. Saving, collaborating, copying, and interchange export retain the original paragraph and inline formatting. Printing notes reserve space on the fragment carrying their reference.

Oversized speeches are paginated again after a forced page turn or after their cue cannot fit at the bottom of a page, in both the editor and PDF. Subsequent dialogue paragraphs and parentheticals participate in the same continuation loop. Fragment indices are mapped back to their original document nodes, including dual-dialogue content and note references. Page previews preserve both internal paragraph offsets and dual-dialogue row boundaries; leading Notes and Sections do not add spacing before the first printed element.

Existing locked-page anchors remain attached to their source block. Internal continuation pages follow natural pagination; this change does not introduce fixed character-position page anchors.
