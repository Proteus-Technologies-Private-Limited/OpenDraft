//! Installed-font lookup for the PDF exporter.
//!
//! The PDF exporter bundles fonts for the scripts it knows about. For anything
//! else (a script nobody shipped a font for) the desktop app can ask the
//! operating system: `system_font_for_text` returns the bytes of an installed
//! font that covers *every* visible character of the text, ready for jsPDF to
//! embed.
//!
//! jsPDF can only embed a single TrueType-outline file. It cannot read a TTC
//! collection, a CFF-based OpenType file (`OTTO`) or a woff, so those faces are
//! skipped here rather than handed back to fail later.
//!
//! The command exists on every platform so `generate_handler!` needs no cfg,
//! but only the desktop builds carry `fontdb`; on Android and iOS it answers
//! `Ok(None)` straight away (the frontend does not call it there either).

// On mobile the pure helpers have no caller (the command is a stub).
#![cfg_attr(any(target_os = "android", target_os = "ios"), allow(dead_code))]

use std::collections::BTreeSet;

/// Largest font file handed back. A CJK face is a few MB to ~20 MB; anything
/// bigger would bloat the PDF and the IPC message beyond reason.
const MAX_FONT_BYTES: u64 = 20 * 1024 * 1024;

// ── Pure logic (no installed fonts involved, unit-tested below) ─────────────

/// The characters a font must cover: every distinct character of `text` that
/// is not whitespace or a control character (those render as nothing, or are
/// laid out by the PDF writer itself).
fn required_chars(text: &str) -> Vec<char> {
    let set: BTreeSet<char> = text
        .chars()
        .filter(|c| !c.is_whitespace() && !c.is_control())
        .collect();
    set.into_iter().collect()
}

/// True when `has_glyph` holds for every required character. An empty
/// requirement is never "covered": there is nothing to look a font up for.
fn covers_all(required: &[char], has_glyph: impl Fn(char) -> bool) -> bool {
    !required.is_empty() && required.iter().all(|&c| has_glyph(c))
}

/// True when the first four bytes of a font file are a single-face TrueType
/// outline font: sfnt version 0x00010000 or `true`. Rejects `ttcf`
/// (collections), `OTTO` (CFF outlines), `wOFF`/`wOF2` and anything else.
fn is_truetype_header(head: &[u8]) -> bool {
    matches!(head.get(..4), Some([0x00, 0x01, 0x00, 0x00]) | Some(b"true"))
}

/// What the ranking needs to know about one installed face.
#[derive(Debug, Clone, PartialEq)]
struct Candidate {
    /// Index back into the caller's own face list.
    index: usize,
    bold: bool,
    italic: bool,
    monospaced: bool,
    size: u64,
    path: String,
}

/// Orders candidates best-first for a requested style:
///  1. exactly the requested bold/italic,
///  2. otherwise the regular face (neither bold nor italic),
///  3. otherwise anything.
///
/// Within a class proportional faces come before monospaced ones (script
/// fallback text is prose), then smaller files (less to embed), then path so
/// the result is deterministic. Files over the size cap are dropped.
fn rank_candidates(mut all: Vec<Candidate>, bold: bool, italic: bool) -> Vec<Candidate> {
    all.retain(|c| c.size > 0 && c.size <= MAX_FONT_BYTES);
    let class = |c: &Candidate| -> u8 {
        if c.bold == bold && c.italic == italic {
            0
        } else if !c.bold && !c.italic {
            1
        } else {
            2
        }
    };
    all.sort_by(|a, b| {
        class(a)
            .cmp(&class(b))
            .then(a.monospaced.cmp(&b.monospaced))
            .then(a.size.cmp(&b.size))
            .then(a.path.cmp(&b.path))
    });
    all
}

// ── Desktop implementation ──────────────────────────────────────────────────

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop {
    use super::*;
    use std::io::Read;
    use std::path::PathBuf;
    use std::sync::OnceLock;

    /// The scanned system fonts. Scanning walks every font directory, so it
    /// happens once per process.
    static DB: OnceLock<fontdb::Database> = OnceLock::new();

    fn database() -> &'static fontdb::Database {
        DB.get_or_init(|| {
            let mut db = fontdb::Database::new();
            db.load_system_fonts();
            db
        })
    }

    /// The file a face came from, when it came from one.
    fn source_path(src: &fontdb::Source) -> Option<PathBuf> {
        match src {
            fontdb::Source::File(p) => Some(p.clone()),
            fontdb::Source::SharedFile(p, _) => Some(p.clone()),
            fontdb::Source::Binary(_) => None,
        }
    }

    /// Reads just the sfnt tag of a file.
    fn file_header(path: &PathBuf) -> Option<[u8; 4]> {
        let mut f = std::fs::File::open(path).ok()?;
        let mut head = [0u8; 4];
        f.read_exact(&mut head).ok()?;
        Some(head)
    }

    pub fn find(text: &str, bold: bool, italic: bool) -> Result<Option<Vec<u8>>, String> {
        let required = required_chars(text);
        if required.is_empty() {
            return Ok(None);
        }
        let db = database();

        // Cheap filtering first: single-face TrueType files under the cap.
        let mut candidates: Vec<Candidate> = Vec::new();
        let mut ids: Vec<fontdb::ID> = Vec::new();
        let mut header_cache: std::collections::HashMap<PathBuf, bool> =
            std::collections::HashMap::new();
        for face in db.faces() {
            // Face 0 of a single-face file; collections are rejected below by
            // their `ttcf` header, but a nonzero index can only mean one.
            if face.index != 0 {
                continue;
            }
            let Some(path) = source_path(&face.source) else { continue };
            let ok = *header_cache.entry(path.clone()).or_insert_with(|| {
                file_header(&path).map(|h| is_truetype_header(&h)).unwrap_or(false)
            });
            if !ok {
                continue;
            }
            let size = match std::fs::metadata(&path) {
                Ok(m) => m.len(),
                Err(_) => continue,
            };
            candidates.push(Candidate {
                index: ids.len(),
                bold: face.weight.0 >= 600,
                italic: face.style != fontdb::Style::Normal,
                monospaced: face.monospaced,
                size,
                path: path.to_string_lossy().into_owned(),
            });
            ids.push(face.id);
        }

        // Best-ranked first; the first that covers the text wins.
        for cand in rank_candidates(candidates, bold, italic) {
            let id = ids[cand.index];
            let covered = db
                .with_face_data(id, |data, index| {
                    ttf_parser::Face::parse(data, index)
                        .map(|face| covers_all(&required, |c| face.glyph_index(c).is_some()))
                        .unwrap_or(false)
                })
                .unwrap_or(false);
            if !covered {
                continue;
            }
            return match std::fs::read(&cand.path) {
                Ok(bytes) if is_truetype_header(&bytes) => Ok(Some(bytes)),
                Ok(_) => continue,
                Err(e) => {
                    eprintln!("[system_fonts] could not read {}: {}", cand.path, e);
                    continue;
                }
            };
        }
        Ok(None)
    }
}

// ── Command ─────────────────────────────────────────────────────────────────

/// The bytes of an installed single-face TrueType font that covers every
/// visible character of `text`, preferring the requested bold/italic and
/// falling back to a regular face. `Ok(None)` when nothing suitable exists.
#[tauri::command]
pub async fn system_font_for_text(
    text: String,
    bold: bool,
    italic: bool,
) -> Result<Option<Vec<u8>>, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // Scanning fonts and reading a face is blocking work: keep it off the
        // async runtime's threads.
        return tauri::async_runtime::spawn_blocking(move || {
            desktop::find(&text, bold, italic)
        })
        .await
        .map_err(|e| format!("system font lookup failed: {e}"))?;
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (text, bold, italic);
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(index: usize, bold: bool, italic: bool, mono: bool, size: u64, path: &str) -> Candidate {
        Candidate { index, bold, italic, monospaced: mono, size, path: path.into() }
    }

    #[test]
    fn required_chars_skips_whitespace_and_controls_and_dedupes() {
        assert_eq!(required_chars("a b\ta\n\u{0}b"), vec!['a', 'b']);
        assert!(required_chars(" \n\t ").is_empty());
        assert!(required_chars("").is_empty());
    }

    #[test]
    fn covers_all_needs_every_char() {
        let req = required_chars("abc");
        assert!(covers_all(&req, |c| "abcd".contains(c)));
        assert!(!covers_all(&req, |c| c != 'c'));
    }

    #[test]
    fn covers_all_is_false_for_nothing_to_cover() {
        assert!(!covers_all(&[], |_| true));
    }

    #[test]
    fn header_accepts_only_single_face_truetype() {
        assert!(is_truetype_header(&[0, 1, 0, 0, 9, 9]));
        assert!(is_truetype_header(b"true"));
        assert!(!is_truetype_header(b"OTTO"));
        assert!(!is_truetype_header(b"ttcf"));
        assert!(!is_truetype_header(b"wOFF"));
        assert!(!is_truetype_header(&[0, 1, 0]));
        assert!(!is_truetype_header(&[]));
    }

    #[test]
    fn ranking_prefers_exact_style_then_regular_then_any() {
        let all = vec![
            cand(0, true, true, false, 10, "bolditalic"),
            cand(1, false, false, false, 10, "regular"),
            cand(2, true, false, false, 10, "bold"),
        ];
        let r = rank_candidates(all.clone(), true, false);
        assert_eq!(r.iter().map(|c| c.index).collect::<Vec<_>>(), vec![2, 1, 0]);
        // Requested regular: regular first, then the styled ones.
        let r = rank_candidates(all.clone(), false, false);
        assert_eq!(r[0].index, 1);
        // Requested bold italic: exact, then regular.
        let r = rank_candidates(all, true, true);
        assert_eq!(r.iter().map(|c| c.index).collect::<Vec<_>>(), vec![0, 1, 2]);
    }

    #[test]
    fn ranking_prefers_proportional_then_smaller_then_path() {
        let all = vec![
            cand(0, false, false, true, 1, "mono"),
            cand(1, false, false, false, 500, "big"),
            cand(2, false, false, false, 100, "b-small"),
            cand(3, false, false, false, 100, "a-small"),
        ];
        let r = rank_candidates(all, false, false);
        assert_eq!(r.iter().map(|c| c.index).collect::<Vec<_>>(), vec![3, 2, 1, 0]);
    }

    #[test]
    fn ranking_drops_oversized_and_empty_files() {
        let all = vec![
            cand(0, false, false, false, MAX_FONT_BYTES + 1, "huge"),
            cand(1, false, false, false, 0, "empty"),
            cand(2, false, false, false, MAX_FONT_BYTES, "edge"),
        ];
        let r = rank_candidates(all, false, false);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].index, 2);
    }

    /// Needs real installed fonts, so it is not part of the normal run:
    /// `cargo test system_fonts -- --ignored --nocapture`.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[test]
    #[ignore]
    fn smoke_finds_installed_fonts() {
        for text in ["Hello", "हिन्दी", "مرحبا", "日本語", "\u{10FFFF}"] {
            let r = desktop::find(text, false, false).expect("lookup must not error");
            println!("{text:?} -> {:?} bytes", r.as_ref().map(|b| b.len()));
            if let Some(b) = r {
                assert!(is_truetype_header(&b));
            }
        }
    }
}
