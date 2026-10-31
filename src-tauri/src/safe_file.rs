//! Recoverable replacement shared by text, binary and linked document saves (#181).
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
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
pub fn external(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("fdx" | "fadein" | "osf" | "fountain" | "txt" | "highland" | "wdz" | "celtx")
    )
}
pub fn backup(dir: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("Cannot create source backup directory: {e}"))?;
    let name: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .take(120)
        .collect();
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
    Ok(path)
}
pub fn replace(path: &Path, bytes: &[u8]) -> Result<(), String> {
    replace_with(path, bytes, |tmp, target| fs::rename(tmp, target))
}
fn replace_with(
    path: &Path,
    bytes: &[u8],
    finalize: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), String> {
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
        if external(path) && path.exists() {
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
    #[test]
    fn backup_keeps_exact_binary_original_and_unique_versions() {
        let dir = dir();
        let path = dir.join("script.fadein");
        let original = vec![0, 255, 40, 19];
        fs::write(&path, &original).unwrap();
        replace(&path, b"new").unwrap();
        replace(&path, b"newer").unwrap();
        let versions: Vec<_> = fs::read_dir(dir.join(".opendraft-originals"))
            .unwrap()
            .map(|e| fs::read(e.unwrap().path()).unwrap())
            .collect();
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
        assert!(replace(&path, b"replacement").is_err());
        assert_eq!(fs::read(path).unwrap(), b"original");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_final_replacement_retains_original_and_verified_backup() {
        let dir = dir();
        let path = dir.join("script.osf");
        fs::write(&path, b"original").unwrap();
        let result = replace_with(&path, b"new", |_, _| {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "injected replacement failure",
            ))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        let backups: Vec<_> = fs::read_dir(dir.join(".opendraft-originals"))
            .unwrap()
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(
            fs::read(backups[0].as_ref().unwrap().path()).unwrap(),
            b"original"
        );
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
        assert!(replace(&path, b"replacement").is_err());
        assert!(path.is_dir());
        fs::remove_dir_all(dir).unwrap();
    }
}
