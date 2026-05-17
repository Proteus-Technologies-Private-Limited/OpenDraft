# Odia (or_IN) Hunspell Dictionary

The Hunspell affix (`or_IN.aff`) and dictionary (`or_IN.dic`) files in this
directory are derived from the **Odia Spelling Checker** Firefox add-on
maintained by Odia Wikipedians (Sipun et al.).

* Source: https://addons.mozilla.org/firefox/addon/odia-spelling-checker/
* Upstream license: **MPL-2.0** (Mozilla Public License v2.0)

## Modifications from upstream

The `.dic` was filtered to drop entries containing non-Odia codepoints (a few
stray glyphs at the top of the upstream file like `|`, `|'`, `Ǎ`, `͇` and
similar). The resulting word list contains only entries composed entirely of
characters in the Odia Unicode block (U+0B00–U+0B7F). Duplicate entries were
removed and the word-count header on the first line was updated to reflect
the filtered total. No words were rewritten or transliterated.

The `.aff` is the upstream file unchanged.

These files are redistributed under MPL-2.0; a copy of the license is
available at https://www.mozilla.org/MPL/2.0/.
