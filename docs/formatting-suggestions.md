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
inside a formatting proposal are a separately signed insertion. They inherit the
accepted baseline style, so rejecting the proposal cannot leave its bold behind.

Compatibility is enforced before collaboration sync; see [Review compatibility](review-compatibility.md).

Ordinary scripts remain available to mixed versions. Formatting proposals are
disabled on older servers and while an older participant is present. Older apps
can join again after pending formatting proposals have been resolved. Saved native/library bodies
contain accepted content, with review data in versioned metadata for compatible
apps. Saving in an older app drops that review data; keep the original backup. Font/colour changes, paragraph alignment and spacing, and
Shift+Enter suggestions remain outside this implementation.

Review follow-ups: type filters appear only with multiple pending suggestions,
and navigation only with multiple shown changes. Accept/Reject on a card advances
to the next shown card and keeps keyboard focus in its controls. There is no
separate Accept/Reject & Next toolbar. Direct editor styling settles proposals for
that style only in the edited range, preserving unrelated styles and ordinary
undo/redo. A legacy stale stamp cannot reapply a style an editor already changed.
Clear Formatting with only a pending removal keeps the removal pending without
reporting an unsupported operation; clearing one's own pending addition withdraws
it, while another reviewer's proposal stays protected.

File → Print treats pending text and character-style suggestions alike. It says
when it is using an accepted-only PDF even if browser printing was preferred.
If PDF generation or handoff fails, it explains the failure and leaves the review
intact, without falling back to printing marked-up text. Disabling the PDF
preference is not offered as a workaround while suggestions remain pending.
