# Formatting suggestions and review

This Core follow-up adds character-style review to the existing Suggest mode.
The existing author filter, text suggestions, element-type suggestions and bulk
resolution remain in use.

Supported styles are bold, italic, underline, strikethrough, subscript and
superscript. Use the normal toolbar, Format menu or keyboard shortcuts on a
selection while Suggest Changes is on. The editor previews the style and marks
it with a dotted highlight. Review cards describe the added/removed style and
its affected text. Multiple style changes in one command are grouped together.
Toggling your own proposal back withdraws the affected range.

The review panel adds change-type filters, Previous/Next navigation and
Accept/Reject & Next. Navigation wraps through the filtered list. Bulk actions
resolve matching suggestions, rather than every suggestion in the document.
Reviewers with a Suggest invite can only withdraw their own changes; the server
also enforces that restriction. Accepting marks the affected text as revised
when Revision Mode is on. Suggesting and rejecting do not.

Formatting proposals store the original and proposed values in a
`suggestionFormat` mark with author, session identity, id and timestamp. Native
files and Yjs retain them; exports and linked external files restore the original
style until acceptance. File → Print uses the accepted PDF copy while formatting
is pending, including when the normal preference is browser printing. Use that
command or PDF export for an accepted-only printout.

Known same-style proposals from another author must be reviewed before that
style can be changed again. Simultaneous agreeing proposals can coexist after a
Yjs merge: withdrawing one leaves the other pending; accepting one settles the
agreeing proposals on that text. Independent styles can overlap. New words typed
inside a formatting proposal are a separately signed insertion and retain their
style as part of that insertion.

Update both clients and the collaboration server before using the feature.
Older clients do not understand the new review mark, and older servers reject
formatting proposals. Font/colour changes, paragraph alignment and spacing, and
Shift+Enter suggestions remain outside this implementation.
