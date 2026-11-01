//! Recoverable replacement shared by text, binary and linked document saves (#181).
//!
//! A file in another application's format is backed up before OpenDraft first
//! overwrites it, so a lossy conversion can always be undone. The caller says
//! whether a backup is needed: once OpenDraft has written a file itself, the
//! next save replaces OpenDraft's own output, and copying that again on every
//! save only fills the writer's folder. Backups that are made are capped at
//! [`KEEP_BACKUPS`] per file name.
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
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .take(120)
        .collect()
}

/// Copy `bytes` into `dir` as a new, verified backup of `name`, then remove
/// all but the newest [`KEEP_BACKUPS`] backups of that name.
pub fn backup(dir: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
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
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut mine: Vec<(String, PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            // `<nanos>-<counter>-<name>`: the prefix must be the two numbers.
            let prefix = name.strip_suffix(&suffix)?;
            let mut parts = prefix.splitn(2, '-');
            let ok = parts.next().is_some_and(|p| p.chars().all(|c| c.is_ascii_digit()))
                && parts.next().is_some_and(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()));
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
            eprintln!("[safe_file] could not remove old backup {}: {e}", path.display());
        }
    }
}

/// Replace `path` with `bytes`, backing up an existing external-format file
/// first when `backup_original` is set.
pub fn replace(path: &Path, bytes: &[u8], backup_original: bool) -> Result<(), String> {
    replace_with(path, bytes, backup_original, |tmp, target| fs::rename(tmp, target))
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
        fs::metadata(path).map(|m| m.is_file() && m.nlink() > 1).unwrap_or(false)
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
    let target = resolve_target(path)?;
    let path = target.as_path();
    let dir = path.parent().ok_or("Invalid save path")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".opendraft-{}.tmp", unique()));
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|e| e.to_string())?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        if fs::read(&tmp).map_err(|e| e.to_string())? != bytes {
            return Err("Replacement verification failed".into());
        }
        if backup_original && external(path) && path.exists() {
            let original =
                fs::read(path).map_err(|e| format!("Cannot read original before backup: {e}"))?;
            backup(
                &dir.join(".opendraft-originals"),
                path.file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("source"),
                &original,
            )?;
            if fs::read(path).map_err(|e| e.to_string())? != original {
                return Err(
                    "The original changed during save. Reopen it before overwriting.".into(),
                );
            }
        }
        if hard_linked(path) {
            // In place, so every name keeps seeing the same file. Not atomic,
            // which is why the verified temporary copy is kept until it is done.
            let mut out = OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(path)
                .map_err(|e| format!("Could not open {} to save: {e}", path.display()))?;
            out.write_all(bytes)
                .and_then(|_| out.sync_all())
                .map_err(|e| format!("Could not save {}: {e}", path.display()))?;
            fs::remove_file(&tmp).map_err(|e| e.to_string())?;
            return Ok(());
        }
        // Never delete the destination to make rename succeed (including Windows).
        if path.is_file() {
            fs::set_permissions(
                &tmp,
                fs::metadata(path).map_err(|e| e.to_string())?.permissions(),
            )
            .map_err(|e| e.to_string())?;
        }
        finalize(&tmp, path).map_err(|e| {
            format!("Could not replace source; original and backup were retained: {e}")
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
            Ok(entries) => entries.map(|e| fs::read(e.unwrap().path()).unwrap()).collect(),
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
        assert!(replace(&path, b"replacement", true).is_err());
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
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "injected replacement failure",
            ))
        });
        assert!(result.is_err());
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
        let mine = names.iter().filter(|n| n.ends_with("-script.fountain")).count();
        assert_eq!(mine, KEEP_BACKUPS);
        // Another file's backup is not counted against this one, nor removed.
        assert_eq!(names.iter().filter(|n| n.ends_with("-other.fountain")).count(), 1);
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
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
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
