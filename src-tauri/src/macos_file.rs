//! Foundation holds the coordinated file grant throughout staging/replacement.
use std::{
    ffi::{CStr, CString},
    path::Path,
};

extern "C" {
    fn opendraft_macos_replace(
        path: *const std::ffi::c_char,
        bytes: *const u8,
        length: usize,
        error: *mut *mut std::ffi::c_char,
    ) -> i32;
    fn opendraft_macos_free_error(message: *mut std::ffi::c_char);
}

pub fn replace(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::os::unix::ffi::OsStrExt;
    let path = CString::new(path.as_os_str().as_bytes()).map_err(|_| "Invalid save path")?;
    let mut error = std::ptr::null_mut();
    // The borrowed path/data stay alive until Foundation's synchronous accessor
    // returns. Error text is copied before returning its allocation to ObjC.
    let ok =
        unsafe { opendraft_macos_replace(path.as_ptr(), bytes.as_ptr(), bytes.len(), &mut error) };
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
        Err(message)
    }
}
