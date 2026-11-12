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
                |path, bytes| macos_file::replace(path, bytes, &dir.join("recovery")),
            )
            .unwrap();
            assert_eq!(fs::read(&path).unwrap(), original);
            let binary = &[0, 255, 128, 10, 0, 90];
            safe_file::replace_selected(
                &path,
                binary,
                true,
                &dir.join("recovery"),
                |path, bytes| macos_file::replace(path, bytes, &dir.join("recovery")),
            )
            .unwrap();
            assert_eq!(fs::read(&path).unwrap(), binary);
            safe_file::replace_selected(&path, b"", false, &dir.join("recovery"), |path, bytes| {
                macos_file::replace(path, bytes, &dir.join("recovery"))
            })
            .unwrap();
            assert!(fs::read(&path).unwrap().is_empty());
        }
        let originals = safe_file::source_backups::list(&dir.join("recovery")).unwrap();
        assert_eq!(originals.len(), 1);
        assert_eq!(
            safe_file::source_backups::read(&dir.join("recovery"), &originals[0].name).unwrap(),
            b"old screenplay"
        );
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 5);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn native_failure_leaves_existing_directory_intact() {
        let dir = dir();
        let target = dir.join("missing/parent/script.pdf");
        let error = macos_file::replace(&target, b"data", &dir.join("recovery")).unwrap_err();
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
            |path, bytes| macos_file::replace(path, bytes, &dir.join("recovery")),
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
            |path, bytes| macos_file::replace(path, bytes, &dir.join("recovery")),
        )
        .unwrap();
        assert_eq!(fs::read(&hardlink).unwrap(), b"next");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn staging_denial_volume_mismatch_and_replacement_errors_use_verified_recovery() {
        for flags in [1, 2, 64, 128] {
            let dir = dir();
            let target = dir.join("script.pdf");
            let recovery = dir.join("recovery");
            fs::write(&target, b"original PDF bytes").unwrap();
            macos_file::replace_for_test(&target, b"replacement", &recovery, flags).unwrap();
            assert_eq!(fs::read(&target).unwrap(), b"replacement");
            let entries = safe_file::source_backups::list(&recovery).unwrap();
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].original_name, "script.pdf");
            assert_eq!(
                safe_file::source_backups::read(&recovery, &entries[0].name).unwrap(),
                b"original PDF bytes"
            );
            fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn fallback_backup_failure_never_truncates_destination() {
        let dir = dir();
        let target = dir.join("script.fdx");
        let recovery = dir.join("not-a-directory");
        fs::write(&target, b"original").unwrap();
        fs::write(&recovery, b"blocked").unwrap();
        let error =
            macos_file::replace_for_test(&target, b"replacement", &recovery, 1).unwrap_err();
        assert!(error.starts_with("Save failed during backup:"), "{error}");
        assert_eq!(fs::read(&target).unwrap(), b"original");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn repeated_partial_write_failures_restore_original_without_evicting_it() {
        let dir = dir();
        let target = dir.join("script.fdx");
        let recovery = dir.join("recovery");
        fs::write(&target, b"original with a longer tail").unwrap();
        for _ in 0..8 {
            let error = macos_file::replace_for_test(&target, b"replacement", &recovery, 1 | 8)
                .unwrap_err();
            assert!(
                error.starts_with("Save failed during replacement:"),
                "{error}"
            );
            assert_eq!(fs::read(&target).unwrap(), b"original with a longer tail");
        }
        let entries = safe_file::source_backups::list(&recovery).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(
            safe_file::source_backups::read(&recovery, &entries[0].name).unwrap(),
            b"original with a longer tail"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_rollback_still_has_a_verified_recovery_copy() {
        let dir = dir();
        let target = dir.join("script.fdx");
        let recovery = dir.join("recovery");
        fs::write(&target, b"original").unwrap();
        let error = macos_file::replace_for_test(&target, b"replacement", &recovery, 1 | 8 | 16)
            .unwrap_err();
        assert!(error.contains("restoration failed"), "{error}");
        let entries = safe_file::source_backups::list(&recovery).unwrap();
        assert_eq!(
            safe_file::source_backups::read(&recovery, &entries[0].name).unwrap(),
            b"original"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_failed_new_fallback_export_removes_only_its_partial_file() {
        let dir = dir();
        let target = dir.join("new.pdf");
        macos_file::replace_for_test(&target, b"new document", &dir.join("recovery"), 1 | 8)
            .unwrap_err();
        assert!(!target.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unsupported_full_sync_falls_back_to_fsync_and_handles_empty_files() {
        let dir = dir();
        let target = dir.join("script.fountain");
        fs::write(&target, b"original").unwrap();
        for bytes in [b"replacement".as_slice(), b"".as_slice()] {
            macos_file::replace_for_test(&target, bytes, &dir.join("recovery"), 1 | 32).unwrap();
            assert_eq!(fs::read(&target).unwrap(), bytes);
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn foundation_exceptions_are_errors_and_do_not_cross_rust_ffi() {
        for flags in [4, 256] {
            let dir = dir();
            let target = dir.join("script.fountain");
            fs::write(&target, b"original").unwrap();
            let error = macos_file::replace_for_test(&target, b"new", &dir.join("recovery"), flags)
                .unwrap_err();
            assert!(
                error.starts_with("Save failed during destination:"),
                "{error}"
            );
            assert!(error.contains("Injected Foundation failure"), "{error}");
            assert!(!error.contains("Error Domain="), "{error}");
            assert_eq!(fs::read(&target).unwrap(), b"original");
            fs::remove_dir_all(dir).unwrap();
        }
    }
    #[test]
    fn native_writer_works_when_only_the_existing_file_is_writable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = dir();
        let parent = dir.join("picked");
        fs::create_dir(&parent).unwrap();
        let target = parent.join("script.fountain");
        fs::write(&target, b"original").unwrap();
        fs::set_permissions(&parent, fs::Permissions::from_mode(0o500)).unwrap();
        let result = macos_file::replace(&target, b"new content", &dir.join("recovery"));
        fs::set_permissions(&parent, fs::Permissions::from_mode(0o700)).unwrap();
        result.unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new content");
        assert_eq!(
            safe_file::source_backups::list(&dir.join("recovery"))
                .unwrap()
                .len(),
            1
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
