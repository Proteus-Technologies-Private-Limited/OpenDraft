//! Path-specific macOS recovery groups. Mobile's older flat backups remain readable.
//! The hash is a lookup hint, not an identity: exact native path bytes are checked
//! before using a group, so a hash collision cannot combine retention histories.
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

static BACKUP_LOCK: Mutex<()> = Mutex::new(());
const IDENTITY: &str = ".source-id";
const DISPLAY_PATH: &str = ".source-path";

#[derive(Debug)]
pub struct Entry {
    pub name: String,
    pub original_name: String,
    pub source_path: Option<String>,
    pub modified_at: u64,
    pub size: u64,
}

fn regular(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|m| m.is_file())
        .unwrap_or(false)
}

fn native_path(path: &Path) -> Vec<u8> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        path.as_os_str().as_bytes().to_vec()
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        path.as_os_str()
            .encode_wide()
            .flat_map(u16::to_le_bytes)
            .collect()
    }
    #[cfg(not(any(unix, windows)))]
    {
        path.as_os_str().as_encoded_bytes().to_vec()
    }
}

fn canonical_source(path: &Path) -> Result<PathBuf, String> {
    // A failed Foundation replacement may have removed the destination. Its
    // canonical parent still gives the same identity for the preserved original.
    match fs::canonicalize(path) {
        Ok(path) => Ok(path),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let parent = path.parent().ok_or("Invalid source path")?;
            let name = path.file_name().ok_or("Invalid source name")?;
            Ok(fs::canonicalize(parent)
                .map_err(|e| e.to_string())?
                .join(name))
        }
        Err(e) => Err(e.to_string()),
    }
}

fn hint(identity: &[u8]) -> String {
    let hash = identity.iter().fold(0xcbf29ce484222325u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    });
    format!("source-{hash:016x}")
}

fn private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    if fs::read(path).map_err(|e| e.to_string())? != bytes {
        return Err("Source recovery metadata verification failed".into());
    }
    Ok(())
}

fn group(root: &Path, source: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let identity = native_path(source);
    let key = hint(&identity);
    for index in 0u64.. {
        let name = if index == 0 {
            key.clone()
        } else {
            format!("{key}-{index}")
        };
        let path = root.join(name);
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        match builder.create(&path) {
            Ok(()) => {
                private_file(&path.join(IDENTITY), &identity)?;
                private_file(
                    &path.join(DISPLAY_PATH),
                    source.to_string_lossy().as_bytes(),
                )?;
                #[cfg(unix)]
                for dir in [&path, root] {
                    fs::File::open(dir)
                        .and_then(|f| f.sync_all())
                        .map_err(|e| e.to_string())?;
                }
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                // Never follow an injected group/metadata symlink. Incomplete
                // groups left by an interrupted write are retained, not reused.
                if fs::symlink_metadata(&path)
                    .map(|m| m.is_dir())
                    .unwrap_or(false)
                    && regular(&path.join(IDENTITY))
                    && regular(&path.join(DISPLAY_PATH))
                    && fs::read(path.join(IDENTITY)).ok().as_deref() == Some(identity.as_slice())
                {
                    return Ok(path);
                }
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    unreachable!()
}

fn original_name(name: &str) -> Option<&str> {
    let mut parts = name.splitn(3, '-');
    for _ in 0..2 {
        let part = parts.next()?;
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
    }
    parts.next().filter(|name| !name.is_empty())
}

pub fn backup(root: &Path, path: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let operation = || {
        let _guard = BACKUP_LOCK
            .lock()
            .map_err(|_| "Source recovery lock failed")?;
        let source = canonical_source(path)?;
        let dir = group(root, &source)?;
        let mut versions = list_files(&dir, "", None)?;
        versions.sort_by(|a, b| b.name.cmp(&a.name));
        if let Some(newest) = versions.first() {
            let copy = dir.join(&newest.name);
            if fs::read(&copy).map_err(|e| e.to_string())? == bytes {
                return Ok(copy);
            }
        }
        let name = source
            .file_name()
            .map(|s| s.to_string_lossy())
            .unwrap_or_default();
        super::backup_impl(&dir, &name, bytes)
    };
    operation().map_err(|error: String| super::save_error("backup", error))
}

fn list_files(dir: &Path, prefix: &str, source: Option<&str>) -> Result<Vec<Entry>, String> {
    let mut result = Vec::new();
    for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        if !item.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        let Some(legacy_name) = original_name(&name) else {
            continue;
        };
        let metadata = item.metadata().map_err(|e| e.to_string())?;
        result.push(Entry {
            name: format!("{prefix}{name}"),
            original_name: source
                .and_then(|s| Path::new(s).file_name())
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| legacy_name.into()),
            source_path: source.map(str::to_owned),
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis().min(u64::MAX as u128) as u64)
                .unwrap_or(0),
            size: metadata.len(),
        });
    }
    Ok(result)
}

pub fn list(root: &Path) -> Result<Vec<Entry>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut result = list_files(root, "", None)?;
    for item in fs::read_dir(root).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let name = item.file_name().to_string_lossy().into_owned();
        if !name.starts_with("source-") || !item.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let metadata = item.path().join(DISPLAY_PATH);
        let source = if regular(&metadata) {
            fs::read_to_string(metadata).ok()
        } else {
            None
        };
        result.extend(list_files(
            &item.path(),
            &format!("{name}/"),
            source.as_deref(),
        )?);
    }
    result.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| b.name.cmp(&a.name))
    });
    Ok(result)
}

pub fn read(root: &Path, id: &str) -> Result<Vec<u8>, String> {
    let parts: Vec<_> = Path::new(id).components().collect();
    if parts.is_empty()
        || parts.len() > 2
        || !parts.iter().all(|p| matches!(p, Component::Normal(_)))
        || original_name(parts.last().unwrap().as_os_str().to_str().unwrap_or("")).is_none()
        || (parts.len() == 2
            && !parts[0]
                .as_os_str()
                .to_string_lossy()
                .starts_with("source-"))
    {
        return Err("Invalid backup name".into());
    }
    let mut path = root.to_path_buf();
    for (index, part) in parts.iter().enumerate() {
        path.push(part.as_os_str());
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink()
            || (index + 1 == parts.len() && !metadata.is_file())
            || (index + 1 < parts.len() && !metadata.is_dir())
        {
            return Err("Invalid backup entry".into());
        }
    }
    fs::read(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "opendraft-source-recovery-{}-{}",
            std::process::id(),
            super::super::unique()
        ));
        fs::create_dir_all(&dir).unwrap();
        (dir.clone(), dir.join("recovery"))
    }
    #[test]
    fn same_names_have_independent_retention_and_metadata() {
        let (dir, root) = fixture();
        let a = dir.join("A/draft.fountain");
        let b = dir.join("B/draft.fountain");
        fs::create_dir_all(a.parent().unwrap()).unwrap();
        fs::create_dir_all(b.parent().unwrap()).unwrap();
        fs::write(&a, b"a").unwrap();
        fs::write(&b, b"b").unwrap();
        backup(&root, &b, b"only original").unwrap();
        for i in 0..12 {
            backup(&root, &a, format!("version {i}").as_bytes()).unwrap();
        }
        let entries = list(&root).unwrap();
        assert_eq!(entries.len(), 6);
        let b_entry = entries
            .iter()
            .find(|e| e.source_path.as_deref() == Some(b.to_str().unwrap()))
            .unwrap();
        assert_eq!(read(&root, &b_entry.name).unwrap(), b"only original");
        assert_eq!(b_entry.original_name, "draft.fountain");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn retries_do_not_evict_distinct_originals_and_newest_is_compared() {
        let (dir, root) = fixture();
        let path = dir.join("script.fdx");
        fs::write(&path, b"first").unwrap();
        backup(&root, &path, b"first").unwrap();
        backup(&root, &path, b"second").unwrap();
        for _ in 0..12 {
            backup(&root, &path, b"second").unwrap();
        }
        assert_eq!(list(&root).unwrap().len(), 2);
        backup(&root, &path, b"first").unwrap();
        assert_eq!(list(&root).unwrap().len(), 3);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn hash_collision_cannot_share_a_history() {
        let (dir, root) = fixture();
        let path = dir.join("script.fdx");
        fs::write(&path, b"original").unwrap();
        let source = canonical_source(&path).unwrap();
        let collision = root.join(hint(&native_path(&source)));
        fs::create_dir_all(&collision).unwrap();
        fs::write(collision.join(IDENTITY), b"another source").unwrap();
        fs::write(collision.join(DISPLAY_PATH), b"other").unwrap();
        let copy = backup(&root, &path, b"original").unwrap();
        assert_ne!(copy.parent().unwrap(), collision);
        assert_eq!(
            fs::read(collision.join(IDENTITY)).unwrap(),
            b"another source"
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn legacy_flat_backups_and_missing_metadata_remain_recoverable() {
        let (dir, root) = fixture();
        fs::create_dir(&root).unwrap();
        super::super::backup(&root, "old-script.fdx", b"legacy").unwrap();
        let path = dir.join("new.fdx");
        fs::write(&path, b"new").unwrap();
        let copy = backup(&root, &path, b"new").unwrap();
        fs::remove_file(copy.parent().unwrap().join(DISPLAY_PATH)).unwrap();
        let entries = list(&root).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|e| e.source_path.is_none()));
        for entry in entries {
            assert!(!read(&root, &entry.name).unwrap().is_empty());
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn concurrent_retries_keep_one_verified_copy() {
        let (dir, root) = fixture();
        let path = dir.join("script.fdx");
        fs::write(&path, b"original").unwrap();
        std::thread::scope(|scope| {
            for _ in 0..8 {
                let root = &root;
                let path = &path;
                scope.spawn(move || {
                    backup(root, path, b"original").unwrap();
                });
            }
        });
        assert_eq!(list(&root).unwrap().len(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn long_unicode_names_fit_and_keep_the_original_export_name() {
        let (dir, root) = fixture();
        let name = format!("{}.fdx", "界".repeat(75));
        let path = dir.join(&name);
        fs::write(&path, b"source").unwrap();
        backup(&root, &path, b"source").unwrap();
        assert_eq!(list(&root).unwrap()[0].original_name, name);
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn symlink_aliases_share_identity_but_recovery_symlinks_are_refused() {
        use std::os::unix::fs::symlink;
        let (dir, root) = fixture();
        let path = dir.join("script.fdx");
        let alias = dir.join("alias.fdx");
        fs::write(&path, b"source").unwrap();
        symlink(&path, &alias).unwrap();
        let copy = backup(&root, &path, b"source").unwrap();
        backup(&root, &alias, b"source").unwrap();
        assert_eq!(list(&root).unwrap().len(), 1);
        let id = list(&root).unwrap()[0].name.clone();
        fs::remove_file(&copy).unwrap();
        symlink(&path, &copy).unwrap();
        assert!(read(&root, &id).is_err());
        assert!(list(&root).unwrap().is_empty());
        for invalid in [
            "../script.fdx",
            "/tmp/script.fdx",
            "source-any/../../script.fdx",
            ".source-id",
        ] {
            assert!(read(&root, invalid).is_err());
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
