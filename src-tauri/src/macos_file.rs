//! Foundation holds the file grant throughout coordination, including recovery
//! and an optional in-place fallback. The callback runs before destructive I/O.
use std::{
    ffi::{CStr, CString},
    path::Path,
};

type PreserveOriginal =
    unsafe extern "C" fn(*mut std::ffi::c_void, *const std::ffi::c_char, *const u8, usize) -> i32;
extern "C" {
    fn opendraft_macos_replace(
        path: *const std::ffi::c_char,
        bytes: *const u8,
        length: usize,
        preserve: PreserveOriginal,
        context: *mut std::ffi::c_void,
        error: *mut *mut std::ffi::c_char,
    ) -> i32;
    fn opendraft_macos_free_error(message: *mut std::ffi::c_char);
    #[cfg(test)]
    fn opendraft_macos_replace_for_test(
        path: *const std::ffi::c_char,
        bytes: *const u8,
        length: usize,
        preserve: PreserveOriginal,
        context: *mut std::ffi::c_void,
        flags: u32,
        error: *mut *mut std::ffi::c_char,
    ) -> i32;
}
struct Recovery<'a> {
    dir: &'a Path,
    error: Option<String>,
}
unsafe extern "C" fn preserve(
    context: *mut std::ffi::c_void,
    path: *const std::ffi::c_char,
    bytes: *const u8,
    length: usize,
) -> i32 {
    use std::os::unix::ffi::OsStrExt;
    let context = &mut *(context as *mut Recovery<'_>);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if path.is_null() || (length != 0 && bytes.is_null()) {
            return Err("Save failed during backup: invalid original".into());
        }
        let path = Path::new(std::ffi::OsStr::from_bytes(CStr::from_ptr(path).to_bytes()));
        let bytes = if length == 0 {
            &[]
        } else {
            std::slice::from_raw_parts(bytes, length)
        };
        crate::safe_file::source_backups::backup(context.dir, path, bytes).map(|_| ())
    }));
    match result {
        Ok(Ok(())) => 1,
        Ok(Err(error)) => {
            context.error = Some(error);
            0
        }
        Err(_) => {
            context.error = Some("Save failed during backup: recovery failed".into());
            0
        }
    }
}

pub fn replace(path: &Path, bytes: &[u8], recovery: &Path) -> Result<(), String> {
    replace_impl(path, bytes, recovery, 0)
}
#[cfg(test)]
pub fn replace_for_test(
    path: &Path,
    bytes: &[u8],
    recovery: &Path,
    flags: u32,
) -> Result<(), String> {
    replace_impl(path, bytes, recovery, flags)
}
fn replace_impl(path: &Path, bytes: &[u8], recovery: &Path, flags: u32) -> Result<(), String> {
    use std::os::unix::ffi::OsStrExt;
    let path = CString::new(path.as_os_str().as_bytes()).map_err(|_| "Invalid save path")?;
    let mut context = Recovery {
        dir: recovery,
        error: None,
    };
    let context_ptr = &mut context as *mut Recovery<'_> as *mut std::ffi::c_void;
    let mut error = std::ptr::null_mut();
    // Path, data and recovery context live until the synchronous accessor
    // returns. Callback failures and Objective-C exceptions never unwind here.
    let ok = unsafe {
        #[cfg(test)]
        {
            opendraft_macos_replace_for_test(
                path.as_ptr(),
                bytes.as_ptr(),
                bytes.len(),
                preserve,
                context_ptr,
                flags,
                &mut error,
            )
        }
        #[cfg(not(test))]
        {
            let _ = flags;
            opendraft_macos_replace(
                path.as_ptr(),
                bytes.as_ptr(),
                bytes.len(),
                preserve,
                context_ptr,
                &mut error,
            )
        }
    };
    let message = if error.is_null() {
        "macOS file replacement failed".to_string()
    } else {
        let message = unsafe { CStr::from_ptr(error) }
            .to_string_lossy()
            .into_owned();
        unsafe { opendraft_macos_free_error(error) };
        message
    };
    if ok == 1 {
        Ok(())
    } else {
        Err(context.error.unwrap_or(message))
    }
}
