//! Native mobile recognition. Each session owns its callbacks, including permission prompts.
#[tauri::command]
pub fn dictation_native_start(id: String, language: String) -> Result<(), String> {
    if id.is_empty() || id.len() > 80 || language.len() > 40 { return Err("Invalid speech session".into()); }
    call("start", &id, &language).map(|_| ())
}
#[tauri::command]
pub fn dictation_native_stop(id: String) -> Result<(), String> { call("stop", &id, "").map(|_| ()) }
#[tauri::command]
pub fn dictation_native_poll(id: String) -> Result<serde_json::Value, String> {
    let json = call("poll", &id, "")?.unwrap_or_else(|| "[]".into());
    serde_json::from_str(&json).map_err(|e| format!("Invalid device speech response: {e}"))
}
#[cfg(target_os = "android")]
fn call(action: &str, id: &str, language: &str) -> Result<Option<String>, String> {
    let value = match action {
        "start" => crate::android_static_call("dictationStart", &[id, language])?,
        "stop" => crate::android_static_call("dictationStop", &[id])?,
        _ => crate::android_static_call("dictationPoll", &[id])?,
    };
    if action != "poll" { if let Some(ref error) = value { return Err(error.clone()); } }
    Ok(value)
}
#[cfg(target_os = "ios")]
fn call(action: &str, id: &str, language: &str) -> Result<Option<String>, String> {
    use std::ffi::{CStr, CString};
    extern "C" {
        fn ios_dictation_start(id: *const std::ffi::c_char, language: *const std::ffi::c_char);
        fn ios_dictation_stop(id: *const std::ffi::c_char);
        fn ios_dictation_poll(id: *const std::ffi::c_char) -> *mut std::ffi::c_char;
        fn ios_free_string(ptr: *mut std::ffi::c_char);
    }
    let id = CString::new(id).map_err(|_| "Invalid speech session")?;
    let lang = CString::new(language).map_err(|_| "Invalid speech language")?;
    unsafe {
        match action {
            "start" => { ios_dictation_start(id.as_ptr(), lang.as_ptr()); Ok(None) },
            "stop" => { ios_dictation_stop(id.as_ptr()); Ok(None) },
            _ => {
                let ptr = ios_dictation_poll(id.as_ptr());
                if ptr.is_null() { return Ok(None); }
                let result = CStr::from_ptr(ptr).to_string_lossy().into_owned();
                ios_free_string(ptr);
                Ok(Some(result))
            }
        }
    }
}
#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn call(_action: &str, _id: &str, _language: &str) -> Result<Option<String>, String> {
    Err("Use Local Whisper or browser recognition on desktop".into())
}
