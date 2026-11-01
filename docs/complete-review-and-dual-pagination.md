# Review projections, complete formatting proposals and dual-dialogue pagination

This follow-up uses the formatting-review (#188) and paragraph-pagination (#187)
foundations. The combined branch contains those commits as dependencies, not
independent replacements for them.

## Review display

The Suggestions panel offers **Show Markup**, **Original** and **Proposed**.
Original and Proposed are detached, read-only document projections. Original
restores every pending proposal's baseline; Proposed previews acceptance of all
changes. Switching views does not resolve suggestions, create undo entries,
autosave the projection or send it to collaborators. Remote updates still appear.
Return to Show Markup to edit, navigate changes, or accept/reject them.

The projections paginate independently. The selected view does not change export
policy: File → Export, linked external files and File → Print use accepted
content. Printing with any pending suggestions uses the accepted PDF copy,
including when browser printing was selected in settings.

## Fonts and paragraph layout

In addition to the existing six character styles, a text selection can propose
font family, font size and colour using the normal formatting controls. Original
values are retained per property; a font change does not erase revision colour
or another character style. Clipboard HTML retains nullable inherited values.

Alignment commands create paragraph proposals. **Tools → Paragraph Layout…**
adds left/right indents, space before/after and line spacing. Measurements are in
points; indents are inward from the document text margins, and line spacing is
a multiple of the standard 12pt baseline. Blank fields inherit the format.
The dialog is available to editors and suggesters, and disabled in read-only
views. Paragraph proposals retain their accepted geometry until resolved.

The editor and PDF use the same columns, spacing and line budget for explicit
paragraph geometry. Enlarged inline fonts reserve a conservative larger grid.
PDF and Word output retain explicit sizes, colours, alignment, indents and
spacing. Native `.odraft` retains all review metadata. External format support
continues to depend on each serializer; do not assume that all new paragraph
properties are represented in every third-party interchange format. Exact wraps
can differ between fonts and renderers.

## Inline line breaks

Shift+Enter adds a proposed `hardBreak` with a `suggestedBreak` node attribute.
A deletion proposal leaves an existing break in place until accepted. Withdrawing
one's own new break removes it. Accept/reject, author identities, native saves,
clipboard HTML and Yjs all retain the distinction. The server validates the
operation and author, rather than relying on marks on an inline atom (which
Yjs does not preserve).

## Long dual dialogue

Oversized dual-dialogue blocks paginate as synchronized visual rows while both
original columns and their text nodes remain intact. Page continuations repeat
the active speaker in each unfinished column and show MORE/CONT'D when enabled.
A finished column does not repeat on later pages. PDF uses the same row plan;
previews and locked-page continuation labels recognize internal dual breaks.

Dual column widths use complete character cells after padding. Rounding a
fractional cell upward made browser wrapping differ between columns. A browser
check compares both columns' continuation positions, in addition to the
editor/PDF page-count and text-preservation tests.

Update clients and the collaboration server together. Earlier clients do not
understand these proposal payloads or break attributes; earlier servers reject
the new updates. This change does not alter the live-collaboration alternate
switching policy, Pro scheduling or AI features.
