//! Compiled on macOS by the file-save CI job; no GUI or signing required.
#[path = "../src-tauri/src/macos_file.rs"]
mod macos_file;
#[path = "../src-tauri/src/safe_file.rs"]
mod safe_file;

#[cfg(test)]
mod native_tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "opendraft-macos-save-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn new_text_and_binary_exports_and_replacements() {
        let dir = dir();
        for name in [
            "Zażółć script.fdx",
            "script.pdf",
            "script.docx",
            "script.odraft",
        ] {
            let path = dir.join(name);
            let original = b"old screenplay";
            safe_file::replace_selected(
                &path,
                original,
                true,
                &dir.join("recovery"),
                macos_file::replace,
            )
            .unwrap();
            assert_eq!(fs::read(&path).unwrap(), original);
            let binary = &[0, 255, 128, 10, 0, 90];
            safe_file::replace_selected(
                &path,
                binary,
                true,
                &dir.join("recovery"),
                macos_file::replace,
            )
            .unwrap();
            assert_eq!(fs::read(&path).unwrap(), binary);
            safe_file::replace_selected(
                &path,
                b"",
                false,
                &dir.join("recovery"),
                macos_file::replace,
            )
            .unwrap();
            assert!(fs::read(&path).unwrap().is_empty());
        }
        let originals: Vec<_> = fs::read_dir(dir.join("recovery"))
            .unwrap()
            .map(|entry| fs::read(entry.unwrap().path()).unwrap())
            .collect();
        // Only the external-format FDX file needs original-file recovery.
        assert_eq!(originals, vec![b"old screenplay".to_vec()]);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 5);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn native_failure_leaves_existing_directory_intact() {
        let dir = dir();
        let target = dir.join("missing/parent/script.pdf");
        let error = macos_file::replace(&target, b"data").unwrap_err();
        // Help -> Diagnostics reads the stage from this prefix.
        assert!(error.starts_with("Save failed during "), "{error}");
        assert!(!target.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn selected_symlinks_and_hardlinks_keep_their_identity() {
        let dir = dir();
        let real = dir.join("real.fountain");
        fs::write(&real, b"original").unwrap();
        let symlink = dir.join("symlink.fountain");
        std::os::unix::fs::symlink(&real, &symlink).unwrap();
        safe_file::replace_selected(
            &symlink,
            b"new",
            true,
            &dir.join("recovery"),
            macos_file::replace,
        )
        .unwrap();
        assert!(fs::symlink_metadata(&symlink)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(&real).unwrap(), b"new");
        let hardlink = dir.join("hardlink.fountain");
        fs::hard_link(&real, &hardlink).unwrap();
        safe_file::replace_selected(
            &real,
            b"next",
            false,
            &dir.join("recovery"),
            macos_file::replace,
        )
        .unwrap();
        assert_eq!(fs::read(&hardlink).unwrap(), b"next");
        fs::remove_dir_all(dir).unwrap();
    }
}
