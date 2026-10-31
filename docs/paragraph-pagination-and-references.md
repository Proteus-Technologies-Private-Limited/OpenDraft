# Paragraph pagination and production references

A long action paragraph or speech can continue onto the next page without
creating separate screenplay elements. Editing, copying, undo and collaboration
operate on the original paragraph. The editor, page previews and PDF exporter
use the shared text wrapper to choose line boundaries. Speeches retain their
character cue, with MORE/CONT'D when enabled. Headings, character names, dual
dialogue and AV rows retain their existing grouping behavior.

To keep production references stable, enable the element numbering for the
format, then choose **Tools → Production → Lock Element Numbers**. New elements
receive suffixes while existing references stay fixed. Choose **Edit Element
Number…** in the same menu to edit the current element's reference. The operation
can be undone. Unlocking returns locked sequences to automatic counting;
manually edited overrides can be cleared using **Use Automatic Number**.

Imported FDX non-scene paragraph numbers are retained as locked references,
independently of scene numbers. Native saves preserve references even when
**Show Element Numbers** is off; external exports respect that visibility
setting. Final Draft's own display of these references still requires testing
in that application.

Existing page locks also retain labels for natural page continuations inside
a paragraph. Those continuation labels follow the paragraph's successive
page turns; they are not fixed character-position anchors.
