# Oversized paragraph pagination

A paragraph taller than a complete script page can continue across pages in the editor and exported PDF. Paragraphs that fit on a complete page retain their existing pagination; they are not split to fill unused space.

Continuation fragments contain at least two visual lines. A nearby sentence ending is preferred when forming fragments; an oversized paragraph can fall back to a line boundary. Continued character speeches use the document's MORE/CONT'D settings.

Visual breaks are editor decorations, not stored paragraph or hard-break nodes. Saving, collaborating, copying, and interchange export retain the original paragraph and inline formatting. Printing notes reserve space on the fragment carrying their reference.

Existing locked-page anchors remain attached to their source block. Internal continuation pages follow natural pagination; this change does not introduce fixed character-position page anchors.
