//! Recoverable replacement shared by text, binary and linked document saves (#181).
//!
//! A file in another application's format is backed up before OpenDraft first
//! overwrites it, so a lossy conversion can always be undone. The caller says
//! whether a backup is needed: once OpenDraft has written a file itself, the
//! next save replaces OpenDraft's own output, and copying that again on every
//! save only fills the writer's folder. Backups that are made are capped at
//! [`KEEP_BACKUPS`] per file name.
#[path = "source_backups.rs"]
pub mod source_backups;

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

/// Backups kept per file name in a backup folder; older ones are removed.
pub const KEEP_BACKUPS: usize = 5;

static NEXT: AtomicU64 = AtomicU64::new(0);
/// Stable, human-readable phase names also identify failures in Diagnostics.
fn save_error(stage: &str, error: impl std::fmt::Display) -> String {
    format!("Save failed during {stage}: {error}")
}

fn unique() -> String {
    format!(
        "{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

/// Whether a file name is in another application's format (not `.odraft`).
pub fn external_name(name: &str) -> bool {
    external(Path::new(name))
}

pub fn external(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("fdx" | "fadein" | "osf" | "fountain" | "txt" | "highland" | "wdz" | "celtx")
    )
}

fn sanitize(name: &str) -> String {
    let mut result = String::new();
    for c in name.chars() {
        let c = if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') {
            c
        } else {
            '_'
        };
        if result.len() + c.len_utf8() > 120 {
            break;
        }
        result.push(c);
    }
    result
}

/// Copy `bytes` into `dir` as a new, verified backup of `name`, then remove
/// all but the newest [`KEEP_BACKUPS`] backups of that name.
pub fn backup(dir: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    backup_impl(dir, name, bytes).map_err(|error| save_error("backup", error))
}

fn backup_impl(dir: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("Cannot create source backup directory: {e}"))?;
    let name = sanitize(name);
    let path = dir.join(format!("{}-{}", unique(), name));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|e| format!("Cannot create source backup: {e}"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("Cannot persist source backup: {e}"))?;
    if fs::read(&path).map_err(|e| e.to_string())? != bytes {
        return Err("Source backup verification failed; original was not replaced".into());
    }
    #[cfg(unix)]
    fs::File::open(dir)
        .and_then(|folder| folder.sync_all())
        .map_err(|e| format!("Cannot persist backup directory: {e}"))?;
    prune(dir, &name, KEEP_BACKUPS);
    Ok(path)
}

/// Remove all but the newest `keep` backups of `sanitized_name` in `dir`.
///
/// Backup names start with a nanosecond timestamp, so name order is age order.
/// Best effort: a backup that cannot be removed is left, never treated as a
/// failed save.
fn prune(dir: &Path, sanitized_name: &str, keep: usize) {
    let suffix = format!("-{sanitized_name}");
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut mine: Vec<(String, PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            // `<nanos>-<counter>-<name>`: the prefix must be the two numbers.
            let prefix = name.strip_suffix(&suffix)?;
            let mut parts = prefix.splitn(2, '-');
            let ok = parts
                .next()
                .is_some_and(|p| p.chars().all(|c| c.is_ascii_digit()))
                && parts
                    .next()
                    .is_some_and(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()));
            ok.then(|| (name, e.path()))
        })
        .collect();
    if mine.len() <= keep {
        return;
    }
    // Zero-pad the timestamp for comparison, in case its digit count changes.
    mine.sort_by_key(|(name, _)| {
        let nanos = name.split('-').next().unwrap_or("");
        format!("{nanos:0>24}{name}")
    });
    let excess = mine.len() - keep;
    for (_, path) in mine.into_iter().take(excess) {
        if let Err(e) = fs::remove_file(&path) {
            eprintln!(
                "[safe_file] could not remove old backup {}: {e}",
                path.display()
            );
        }
    }
}

/// Replace `path` with `bytes`, backing up an existing external-format file
/// first when `backup_original` is set.
pub fn replace(path: &Path, bytes: &[u8], backup_original: bool) -> Result<(), String> {
    replace_with(path, bytes, backup_original, |tmp, target| {
        fs::rename(tmp, target)
    })
}

/// File-only picker grants cannot create sibling temporary files or backups.
/// Keep the verified original in the application's recovery directory, then
/// let the platform coordinate an atomic write using its permitted staging area.
#[cfg(any(target_os = "macos", test))]
pub fn replace_selected(
    path: &Path,
    bytes: &[u8],
    backup_original: bool,
    recovery_dir: &Path,
    write: impl FnOnce(&Path, &[u8]) -> Result<(), String>,
) -> Result<(), String> {
    let target = resolve_target(path).map_err(|error| save_error("destination", error))?;
    match fs::metadata(&target) {
        Ok(meta) if !meta.is_file() => {
            return Err(save_error("destination", "Save destination is not a file"))
        }
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            return Err(save_error("destination", error))
        }
        _ => {}
    }
    if backup_original && external(&target) && target.exists() {
        let original = fs::read(&target).map_err(|error| {
            save_error(
                "backup",
                format!("Cannot read original before backup: {error}"),
            )
        })?;
        source_backups::backup(recovery_dir, &target, &original)?;
        if fs::read(&target).map_err(|error| save_error("backup", error))? != original {
            return Err(save_error(
                "backup",
                "The original changed during save. Reopen it before overwriting.",
            ));
        }
    }
    // The native coordinator also owns hard-link writes and any recoverable
    // in-place fallback; never bypass coordination by truncating here.
    // The platform writer reports its own stage (staging or replacement).
    write(&target, bytes)
}

/// A symlink is saved through, to the file it points at; renaming over the
/// link itself would leave the real file untouched and the link a copy.
fn resolve_target(path: &Path) -> Result<PathBuf, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => fs::canonicalize(path)
            .map_err(|e| format!("Cannot follow the link {}: {e}", path.display())),
        _ => Ok(path.to_path_buf()),
    }
}

/// More than one directory entry names this file (a hard link). Renaming a new
/// file over one name would split it from the others, so it is written in place.
fn hard_linked(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        fs::metadata(path)
            .map(|m| m.is_file() && m.nlink() > 1)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        false
    }
}

fn replace_with(
    path: &Path,
    bytes: &[u8],
    backup_original: bool,
    finalize: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), String> {
    let target = resolve_target(path).map_err(|error| save_error("destination", error))?;
    let path = target.as_path();
    let dir = path
        .parent()
        .ok_or_else(|| save_error("destination", "Invalid save path"))?;
    fs::create_dir_all(dir).map_err(|error| save_error("destination", error))?;
    let tmp = dir.join(format!(".opendraft-{}.tmp", unique()));
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|error| save_error("staging", error))?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| save_error("staging", error))?;
        drop(file);
        if fs::read(&tmp).map_err(|error| save_error("staging", error))? != bytes {
            return Err(save_error("staging", "Replacement verification failed"));
        }
        if backup_original && external(path) && path.exists() {
            let original = fs::read(path).map_err(|e| {
                save_error("backup", format!("Cannot read original before backup: {e}"))
            })?;
            backup(
                &dir.join(".opendraft-originals"),
                path.file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("source"),
                &original,
            )?;
            if fs::read(path).map_err(|error| save_error("backup", error))? != original {
                return Err(save_error(
                    "backup",
                    "The original changed during save. Reopen it before overwriting.",
                ));
            }
        }
        if hard_linked(path) {
            // In place, so every name keeps seeing the same file. Not atomic,
            // which is why the verified temporary copy is kept until it is done.
            let mut out = OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(path)
                .map_err(|e| {
                    save_error(
                        "replacement",
                        format!("Could not open {} to save: {e}", path.display()),
                    )
                })?;
            out.write_all(bytes)
                .and_then(|_| out.sync_all())
                .map_err(|e| {
                    save_error(
                        "replacement",
                        format!("Could not save {}: {e}", path.display()),
                    )
                })?;
            fs::remove_file(&tmp).map_err(|error| save_error("cleanup", error))?;
            return Ok(());
        }
        // Never delete the destination to make rename succeed (including Windows).
        if path.is_file() {
            fs::set_permissions(
                &tmp,
                fs::metadata(path)
                    .map_err(|error| save_error("replacement", error))?
                    .permissions(),
            )
            .map_err(|error| save_error("replacement", error))?;
        }
        finalize(&tmp, path).map_err(|e| {
            save_error(
                "replacement",
                format!("Could not replace source; original and backup were retained: {e}"),
            )
        })?;
        #[cfg(unix)]
        {
            let _ = fs::File::open(dir).and_then(|f| f.sync_all());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn dir() -> PathBuf {
        let p = std::env::temp_dir().join(format!("opendraft-safe-save-{}", unique()));
        fs::create_dir_all(&p).unwrap();
        p
    }
    fn backups(dir: &Path) -> Vec<Vec<u8>> {
        match fs::read_dir(dir.join(".opendraft-originals")) {
            Ok(entries) => entries
                .map(|e| fs::read(e.unwrap().path()).unwrap())
                .collect(),
            Err(_) => Vec::new(),
        }
    }
    #[test]
    fn backup_keeps_exact_binary_original_and_unique_versions() {
        let dir = dir();
        let path = dir.join("script.fadein");
        let original = vec![0, 255, 40, 19];
        fs::write(&path, &original).unwrap();
        replace(&path, b"new", true).unwrap();
        replace(&path, b"newer", true).unwrap();
        let versions = backups(&dir);
        assert!(versions.contains(&original));
        assert!(versions.contains(&b"new".to_vec()));
        assert_eq!(fs::read(path).unwrap(), b"newer");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn backup_failure_never_changes_original() {
        let dir = dir();
        let path = dir.join("script.osf");
        fs::write(&path, b"original").unwrap();
        fs::write(dir.join(".opendraft-originals"), b"not a folder").unwrap();
        let error = replace(&path, b"replacement", true).unwrap_err();
        assert!(error.starts_with("Save failed during backup:"), "{error}");
        assert_eq!(fs::read(path).unwrap(), b"original");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_final_replacement_retains_original_and_verified_backup() {
        let dir = dir();
        let path = dir.join("script.osf");
        fs::write(&path, b"original").unwrap();
        let result = replace_with(&path, b"new", true, |_, _| {
            Err(std::io::Error::from_raw_os_error(1))
        });
        let error = result.unwrap_err();
        assert!(
            error.starts_with("Save failed during replacement:"),
            "{error}"
        );
        assert!(error.contains("os error 1"), "{error}");
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(backups(&dir), vec![b"original".to_vec()]);
        assert!(!fs::read_dir(&dir).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn non_file_destination_is_not_destroyed() {
        let dir = dir();
        let path = dir.join("script.fdx");
        fs::create_dir(&path).unwrap();
        assert!(replace(&path, b"replacement", true).is_err());
        assert!(path.is_dir());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn backups_are_capped_per_file_name() {
        let dir = dir();
        let path = dir.join("script.fountain");
        let other = dir.join("other.fountain");
        fs::write(&path, "v0").unwrap();
        fs::write(&other, "o0").unwrap();
        replace(&other, b"o1", true).unwrap();
        for i in 1..=12 {
            replace(&path, format!("v{i}").as_bytes(), true).unwrap();
        }
        let names: Vec<String> = fs::read_dir(dir.join(".opendraft-originals"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        let mine = names
            .iter()
            .filter(|n| n.ends_with("-script.fountain"))
            .count();
        assert_eq!(mine, KEEP_BACKUPS);
        // Another file's backup is not counted against this one, nor removed.
        assert_eq!(
            names
                .iter()
                .filter(|n| n.ends_with("-other.fountain"))
                .count(),
            1
        );
        // The newest are the ones kept: v7..v11 were the originals of saves 8..12.
        let kept = backups(&dir);
        for i in 7..=11 {
            assert!(kept.contains(&format!("v{i}").into_bytes()), "missing v{i}");
        }
        assert!(!kept.contains(&b"v0".to_vec()));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn no_backup_when_the_caller_says_the_file_is_its_own() {
        let dir = dir();
        let path = dir.join("script.fdx");
        fs::write(&path, "opendraft wrote this").unwrap();
        replace(&path, b"next save", false).unwrap();
        assert!(backups(&dir).is_empty());
        assert!(!dir.join(".opendraft-originals").exists());
        assert_eq!(fs::read(&path).unwrap(), b"next save");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn native_files_are_never_backed_up() {
        let dir = dir();
        let path = dir.join("script.odraft");
        fs::write(&path, "{}").unwrap();
        replace(&path, b"{\"a\":1}", true).unwrap();
        assert!(!dir.join(".opendraft-originals").exists());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn selected_file_backup_is_in_recovery_directory_not_beside_destination() {
        let dir = dir();
        let destination = dir.join("picked");
        let recovery = dir.join("app-data/source-backups");
        fs::create_dir(&destination).unwrap();
        let path = destination.join("script.fdx");
        fs::write(&path, [0, 255, 1]).unwrap();
        replace_selected(&path, b"replacement", true, &recovery, |path, bytes| {
            // The platform writer only needs the selected path, not siblings.
            assert_eq!(fs::read_dir(&destination).unwrap().count(), 1);
            fs::write(path, bytes).map_err(|error| error.to_string())
        })
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"replacement");
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 1);
        let entries = source_backups::list(&recovery).unwrap();
        let backup = recovery.join(&entries[0].name);
        assert_eq!(fs::read(backup).unwrap(), [0, 255, 1]);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn selected_file_backup_failure_does_not_call_platform_writer() {
        let dir = dir();
        let path = dir.join("script.fountain");
        let recovery = dir.join("not-a-directory");
        fs::write(&path, b"original").unwrap();
        fs::write(&recovery, b"blocked").unwrap();
        let error = replace_selected(&path, b"new", true, &recovery, |_, _| {
            panic!("must not overwrite without a verified backup")
        })
        .unwrap_err();
        assert!(error.starts_with("Save failed during backup:"), "{error}");
        assert_eq!(fs::read(&path).unwrap(), b"original");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn selected_file_platform_failure_retains_original_and_recovery_copy() {
        let dir = dir();
        let path = dir.join("script.osf");
        let recovery = dir.join("recovery");
        fs::write(&path, b"original").unwrap();
        assert!(replace_selected(&path, b"new", true, &recovery, |_, _| {
            Err("injected platform write failure".into())
        })
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        let entries = source_backups::list(&recovery).unwrap();
        let backup = recovery.join(&entries[0].name);
        assert_eq!(fs::read(backup).unwrap(), b"original");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn destination_failure_keeps_its_phase() {
        let dir = dir();
        let parent = dir.join("not-a-folder");
        fs::write(&parent, b"keep this file").unwrap();
        let error = replace(&parent.join("script.fdx"), b"replacement", true).unwrap_err();
        assert!(
            error.starts_with("Save failed during destination:"),
            "{error}"
        );
        assert_eq!(fs::read(&parent).unwrap(), b"keep this file");
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn file_only_access_succeeds_without_writable_parent() {
        use std::os::unix::fs::PermissionsExt;
        let dir = dir();
        let picked = dir.join("picked");
        fs::create_dir(&picked).unwrap();
        let path = picked.join("script.txt");
        fs::write(&path, b"original").unwrap();
        fs::set_permissions(&picked, fs::Permissions::from_mode(0o500)).unwrap();
        // An unprivileged process cannot create the old sibling .tmp file.
        let sibling_allowed = fs::write(picked.join("probe"), b"probe").is_ok();
        assert!(
            !sibling_allowed,
            "Run permission tests as an unprivileged user, not root"
        );
        assert!(replace(&path, b"old writer", true).is_err());
        let result = replace_selected(
            &path,
            b"new writer",
            true,
            &dir.join("recovery"),
            |path, bytes| fs::write(path, bytes).map_err(|error| error.to_string()),
        );
        fs::set_permissions(&picked, fs::Permissions::from_mode(0o700)).unwrap();
        result.unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new writer");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn selected_directory_is_refused_before_platform_write() {
        let dir = dir();
        let error = replace_selected(&dir, b"new", false, &dir.join("recovery"), |_, _| {
            panic!("must not overwrite a directory")
        })
        .unwrap_err();
        assert!(
            error.starts_with("Save failed during destination:"),
            "{error}"
        );
        assert!(dir.is_dir());
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn staging_failure_preserves_os_error_and_original() {
        use std::os::unix::fs::PermissionsExt;
        let dir = dir();
        let path = dir.join("script.fdx");
        fs::write(&path, b"original").unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
        // Privileged test runners can bypass permissions; ordinary CI cannot.
        let privileged = fs::write(dir.join("probe"), b"probe").is_ok();
        let result = if privileged {
            None
        } else {
            Some(replace(&path, b"replacement", true))
        };
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        if let Some(result) = result {
            let error = result.unwrap_err();
            assert!(error.starts_with("Save failed during staging:"), "{error}");
            assert!(error.contains("os error"), "{error}");
        }
        assert_eq!(fs::read(&path).unwrap(), b"original");
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn saving_through_a_symlink_updates_the_real_file_and_keeps_the_link() {
        let dir = dir();
        let real_dir = dir.join("real");
        fs::create_dir_all(&real_dir).unwrap();
        let real = real_dir.join("script.fdx");
        fs::write(&real, "orig").unwrap();
        let link = dir.join("linked.fdx");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        replace(&link, b"new", true).unwrap();
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(&real).unwrap(), b"new");
        // The backup sits beside the real file, where the original lived.
        assert!(real_dir.join(".opendraft-originals").is_dir());
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn hard_linked_names_all_see_the_save() {
        let dir = dir();
        let a = dir.join("a.osf");
        let b = dir.join("b.osf");
        fs::write(&a, "orig").unwrap();
        fs::hard_link(&a, &b).unwrap();
        replace(&a, b"new", true).unwrap();
        assert_eq!(fs::read(&b).unwrap(), b"new");
        assert_eq!(backups(&dir), vec![b"orig".to_vec()]);
        assert!(!fs::read_dir(&dir).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
        fs::remove_dir_all(dir).unwrap();
    }
}
