use std::sync::Mutex;
use percent_encoding::percent_decode_str;
use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri::menu::{Menu, Submenu, PredefinedMenuItem, MenuItem};

// ── Android JNI context ──────────────────────────────────────────────────
// Everything below that talks to Android needs the JavaVM and the Activity.
//
// This used to come from `ndk_context::android_context()`. tao 0.35 (tauri
// 2.11) dropped ndk-context entirely — multi-window means several activities,
// so a single global context no longer makes sense, and tao replaced it with a
// per-activity registry. Nothing initializes ndk-context anymore, so
// `android_context()` panics *unconditionally* with "android context was not
// initialized", and `panic = "abort"` turns that into a SIGABRT that killed
// the app on every cold start.
//
// tao's replacement returns an Option instead of panicking, which is also why
// every helper here is fallible rather than guarded — there is no safe way to
// "try" a panicking call under `panic = "abort"`, since catch_unwind never
// runs.

/// The JavaVM + Activity pointers, mirroring the shape ndk-context provided so
/// the call sites below read the same as before.
#[cfg(target_os = "android")]
struct AndroidCtx {
    vm: *mut std::ffi::c_void,
    context: *mut std::ffi::c_void,
}

#[cfg(target_os = "android")]
impl AndroidCtx {
    fn vm(&self) -> *mut std::ffi::c_void {
        self.vm
    }
    fn context(&self) -> *mut std::ffi::c_void {
        self.context
    }
}

/// The main activity's JNI context, or None before one exists.
///
/// `tauri::tao` is tauri's own re-export, so this is guaranteed to be the same
/// tao instance that owns the registry — a separately declared `tao` dependency
/// could compile against a different copy and always read empty.
#[cfg(target_os = "android")]
fn android_context() -> Option<AndroidCtx> {
    let ctx = tauri::tao::platform::android::prelude::main_android_context()?;
    Some(AndroidCtx {
        vm: ctx.java_vm,
        context: ctx.context_jobject,
    })
}

/// Message for the Result-returning helpers when no activity exists yet.
#[cfg(target_os = "android")]
const NO_ANDROID_CONTEXT: &str = "Android activity is not available yet";

// ── Android content URI reading (JNI) ────────────────────────────────────
// On Android, files opened via intents use content:// URIs. These cannot be
// read with std::fs — we must go through Android's ContentResolver via JNI.

#[derive(serde::Serialize)]
struct ContentUriResult {
    content: String,
    filename: String,
}

#[tauri::command]
fn read_content_uri(uri: String) -> Result<ContentUriResult, String> {
    #[cfg(target_os = "android")]
    {
        android_read_content_uri(&uri)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = uri;
        Err("Content URI reading is only supported on Android".to_string())
    }
}

/// A content:// document read as raw bytes.
#[derive(serde::Serialize)]
struct ContentUriBytes {
    bytes: Vec<u8>,
    filename: String,
}

/// Read a picked document as bytes rather than text.
///
/// The text path decodes through a Scanner as UTF-8, which destroys anything
/// that is not text — so archive formats could not be imported on Android at
/// all. `.fadein` is a zip, and it was rejected with "compressed archives
/// cannot be opened on this platform" for exactly this reason.
#[tauri::command]
fn read_content_uri_bytes(uri: String) -> Result<ContentUriBytes, String> {
    #[cfg(target_os = "android")]
    {
        android_read_content_uri_bytes(&uri)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = uri;
        Err("Content URI reading is only supported on Android".to_string())
    }
}

#[cfg(target_os = "android")]
fn android_read_content_uri_bytes(uri_str: &str) -> Result<ContentUriBytes, String> {
    use jni::objects::{JByteArray, JObject, JValue};
    use jni::JavaVM;

    let ctx = android_context().ok_or(NO_ANDROID_CONTEXT)?;
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("Failed to get JVM: {}", e))?;
    let mut env = vm.attach_current_thread()
        .map_err(|e| format!("Failed to attach JNI thread: {}", e))?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    // Converted to a JObject once: the URI string is needed twice below, and
    // JObject::from consumes the JString.
    let uri_jobj = JObject::from(
        env.new_string(uri_str)
            .map_err(|e| format!("JNI new_string: {}", e))?,
    );
    let uri_obj = env.call_static_method(
        "android/net/Uri", "parse",
        "(Ljava/lang/String;)Landroid/net/Uri;",
        &[JValue::Object(&uri_jobj)],
    ).map_err(|e| format!("Uri.parse: {}", e))?
     .l().map_err(|e| format!("Uri.parse cast: {}", e))?;

    let resolver = env.call_method(
        &activity, "getContentResolver",
        "()Landroid/content/ContentResolver;", &[],
    ).map_err(|e| format!("getContentResolver: {}", e))?
     .l().map_err(|e| format!("resolver cast: {}", e))?;

    // Same filename resolution as the text path: display name, with an
    // extension recovered from the MIME type when the provider omits one —
    // the importer dispatches on extension, so a bare name would break it.
    let mut filename = android_query_display_name(&mut env, &resolver, &uri_obj)
        .unwrap_or_else(|| extract_filename_from_uri(uri_str));
    if !filename.contains('.') {
        if let Some(ext) = android_query_mime_extension(&mut env, &resolver, &uri_obj) {
            filename = format!("{}.{}", filename, ext);
        }
    }

    // The read itself lives in MainActivity.readUriBytes: minSdk is 24, so
    // InputStream.readAllBytes() is unavailable and a JNI read loop would be
    // far more code than a Kotlin one-liner.
    let bytes_obj = env.call_static_method(
        "com/proteus/opendraft/MainActivity", "readUriBytes",
        "(Landroid/content/Context;Ljava/lang/String;)[B",
        &[JValue::Object(&activity), JValue::Object(&uri_jobj)],
    ).map_err(|e| format!("readUriBytes: {}", e))?
     .l().map_err(|e| format!("readUriBytes cast: {}", e))?;

    if bytes_obj.is_null() {
        return Err(format!(
            "Could not read {}. The file may have been moved or deleted, or its provider \
             may be offline.",
            filename
        ));
    }

    let arr = JByteArray::from(bytes_obj);
    let bytes = env.convert_byte_array(&arr)
        .map_err(|e| format!("convert_byte_array: {}", e))?;

    eprintln!("[content-uri] Read {} bytes, filename: {}", bytes.len(), filename);
    Ok(ContentUriBytes { bytes, filename })
}

/// Overwrite a document the user picked, in place.
///
/// The Android half of open-in-place (issue #62).  A `content://` URI with a
/// persisted write grant is Android's answer to an iOS security-scoped
/// bookmark: both survive a relaunch and both name the user's real file rather
/// than a copy in the sandbox.
#[tauri::command]
fn write_content_uri(uri: String, contents: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_write_content_uri(&uri, contents.as_bytes())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (uri, contents);
        Err("Content URI writing is only supported on Android".to_string())
    }
}

/// Write raw bytes to a content URI — the archive formats, which cannot go
/// through the text path without being destroyed by the UTF-8 round trip.
#[tauri::command]
fn write_content_uri_bytes(uri: String, contents: Vec<u8>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_write_content_uri(&uri, &contents)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (uri, contents);
        Err("Content URI writing is only supported on Android".to_string())
    }
}

#[cfg(target_os = "android")]
fn android_write_content_uri(uri_str: &str, contents: &[u8]) -> Result<(), String> {
    use jni::objects::{JObject, JValue};
    use jni::JavaVM;

    let ctx = android_context().ok_or(NO_ANDROID_CONTEXT)?;
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("Failed to get JVM: {}", e))?;
    let mut env = vm.attach_current_thread()
        .map_err(|e| format!("Failed to attach JNI thread: {}", e))?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    let uri_jstr = env.new_string(uri_str)
        .map_err(|e| format!("JNI new_string: {}", e))?;
    let uri_obj = env.call_static_method(
        "android/net/Uri", "parse",
        "(Ljava/lang/String;)Landroid/net/Uri;",
        &[JValue::Object(&JObject::from(uri_jstr))],
    ).map_err(|e| format!("Uri.parse: {}", e))?
     .l().map_err(|e| format!("Uri.parse cast: {}", e))?;

    let resolver = env.call_method(
        &activity, "getContentResolver",
        "()Landroid/content/ContentResolver;", &[],
    ).map_err(|e| format!("getContentResolver: {}", e))?
     .l().map_err(|e| format!("resolver cast: {}", e))?;

    // Mode "wt" truncates before writing.  Plain "w" leaves any trailing bytes
    // of a longer previous version in place, which would append garbage to the
    // end of a screenplay that got shorter.
    let mode = env.new_string("wt")
        .map_err(|e| format!("JNI new_string: {}", e))?;
    let output_stream = env.call_method(
        &resolver, "openOutputStream",
        "(Landroid/net/Uri;Ljava/lang/String;)Ljava/io/OutputStream;",
        &[JValue::Object(&uri_obj), JValue::Object(&JObject::from(mode))],
    ).map_err(|e| format!("openOutputStream: {}", e))?
     .l().map_err(|e| format!("openOutputStream cast: {}", e))?;

    if output_stream.is_null() {
        return Err(
            "Could not open the file for writing. The app may have lost permission to it — \
             open it again from Files."
                .to_string(),
        );
    }

    // Write UTF-8 bytes through the stream, then flush and close.  Errors are
    // captured so the stream is always closed before returning.
    let write_result = (|| -> Result<(), String> {
        let bytes = env.byte_array_from_slice(contents)
            .map_err(|e| format!("byte_array_from_slice: {}", e))?;
        env.call_method(
            &output_stream, "write", "([B)V",
            &[JValue::Object(&JObject::from(bytes))],
        ).map_err(|e| format!("OutputStream.write: {}", e))?;
        env.call_method(&output_stream, "flush", "()V", &[])
            .map_err(|e| format!("OutputStream.flush: {}", e))?;
        Ok(())
    })();

    let _ = env.call_method(&output_stream, "close", "()V", &[]);

    // A pending Java exception would poison the next JNI call on this thread.
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
    }

    write_result?;
    eprintln!("[content-uri] Wrote {} bytes to {}", contents.len(), uri_str);
    Ok(())
}

#[cfg(target_os = "android")]
fn android_read_content_uri(uri_str: &str) -> Result<ContentUriResult, String> {
    use jni::objects::{JObject, JString, JValue};
    use jni::JavaVM;

    let ctx = android_context().ok_or(NO_ANDROID_CONTEXT)?;
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("Failed to get JVM: {}", e))?;
    let mut env = vm.attach_current_thread()
        .map_err(|e| format!("Failed to attach JNI thread: {}", e))?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    // Parse URI string → android.net.Uri
    let uri_jstr = env.new_string(uri_str)
        .map_err(|e| format!("JNI new_string: {}", e))?;
    let uri_obj = env.call_static_method(
        "android/net/Uri", "parse",
        "(Ljava/lang/String;)Landroid/net/Uri;",
        &[JValue::Object(&JObject::from(uri_jstr))],
    ).map_err(|e| format!("Uri.parse: {}", e))?
     .l().map_err(|e| format!("Uri.parse cast: {}", e))?;

    // Get ContentResolver
    let resolver = env.call_method(
        &activity, "getContentResolver",
        "()Landroid/content/ContentResolver;", &[],
    ).map_err(|e| format!("getContentResolver: {}", e))?
     .l().map_err(|e| format!("resolver cast: {}", e))?;

    // ── Query display name via Cursor ────────────────────────────────
    let mut filename = android_query_display_name(&mut env, &resolver, &uri_obj)
        .unwrap_or_else(|| extract_filename_from_uri(uri_str));

    // If display name has no file extension, query MIME type and append one.
    // Some Android content providers return display names without extensions.
    if !filename.contains('.') {
        if let Some(ext) = android_query_mime_extension(&mut env, &resolver, &uri_obj) {
            filename = format!("{}.{}", filename, ext);
            eprintln!("[content-uri] Added extension from MIME: {}", filename);
        }
    }

    // ── Read content via InputStream + Scanner ───────────────────────
    let input_stream = env.call_method(
        &resolver, "openInputStream",
        "(Landroid/net/Uri;)Ljava/io/InputStream;",
        &[JValue::Object(&uri_obj)],
    ).map_err(|e| format!("openInputStream: {}", e))?
     .l().map_err(|e| format!("openInputStream cast: {}", e))?;

    if input_stream.is_null() {
        return Err("ContentResolver.openInputStream returned null".to_string());
    }

    // Scanner(inputStream).useDelimiter("\\A").next() reads the entire stream
    let scanner = env.new_object(
        "java/util/Scanner",
        "(Ljava/io/InputStream;)V",
        &[JValue::Object(&input_stream)],
    ).map_err(|e| format!("new Scanner: {}", e))?;

    let delim = env.new_string("\\A")
        .map_err(|e| format!("delim string: {}", e))?;
    let _ = env.call_method(
        &scanner, "useDelimiter",
        "(Ljava/lang/String;)Ljava/util/Scanner;",
        &[JValue::Object(&JObject::from(delim))],
    ).map_err(|e| format!("useDelimiter: {}", e))?;

    let has_next = env.call_method(&scanner, "hasNext", "()Z", &[])
        .map_err(|e| format!("hasNext: {}", e))?
        .z().map_err(|e| format!("hasNext cast: {}", e))?;

    let content = if has_next {
        let result_obj = env.call_method(&scanner, "next", "()Ljava/lang/String;", &[])
            .map_err(|e| format!("next: {}", e))?
            .l().map_err(|e| format!("next cast: {}", e))?;
        let jstr: JString = result_obj.into();
        let java_str = env.get_string(&jstr)
            .map_err(|e| format!("get_string: {}", e))?;
        java_str.to_string_lossy().into_owned()
    } else {
        String::new()
    };

    let _ = env.call_method(&scanner, "close", "()V", &[]);

    eprintln!("[content-uri] Read {} chars, filename: {}", content.len(), filename);
    Ok(ContentUriResult { content, filename })
}

#[cfg(target_os = "android")]
fn android_query_display_name(
    env: &mut jni::JNIEnv,
    resolver: &jni::objects::JObject,
    uri: &jni::objects::JObject,
) -> Option<String> {
    use jni::objects::{JObject, JValue};

    // Create projection array: ["_display_name"]
    let col_name = env.new_string("_display_name").ok()?;
    let string_class = env.find_class("java/lang/String").ok()?;
    let projection = env.new_object_array(1, &string_class, &JObject::from(col_name)).ok()?;

    // query(uri, projection, null, null, null)
    let cursor = env.call_method(
        resolver, "query",
        "(Landroid/net/Uri;[Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;Ljava/lang/String;)Landroid/database/Cursor;",
        &[
            JValue::Object(uri),
            JValue::Object(&JObject::from(projection)),
            JValue::Object(&JObject::null()),
            JValue::Object(&JObject::null()),
            JValue::Object(&JObject::null()),
        ],
    ).ok()?.l().ok()?;

    if cursor.is_null() { return None; }

    let has_first = env.call_method(&cursor, "moveToFirst", "()Z", &[])
        .ok()?.z().ok()?;
    if !has_first {
        let _ = env.call_method(&cursor, "close", "()V", &[]);
        return None;
    }

    let name_obj = env.call_method(
        &cursor, "getString", "(I)Ljava/lang/String;",
        &[JValue::Int(0)],
    ).ok()?.l().ok()?;
    let _ = env.call_method(&cursor, "close", "()V", &[]);

    if name_obj.is_null() { return None; }

    let name_jstr: jni::objects::JString = name_obj.into();
    let java_str = env.get_string(&name_jstr).ok()?;
    let result = java_str.to_string_lossy().into_owned();
    if result.is_empty() { None } else { Some(result) }
}

/// Query the MIME type from ContentResolver and map it to a file extension.
/// Returns None if the MIME type can't be determined or doesn't map to a known extension.
#[cfg(target_os = "android")]
fn android_query_mime_extension(
    env: &mut jni::JNIEnv,
    resolver: &jni::objects::JObject,
    uri: &jni::objects::JObject,
) -> Option<String> {
    use jni::objects::{JObject, JValue};

    // resolver.getType(uri) → String (MIME type)
    let mime_obj = env.call_method(
        resolver, "getType",
        "(Landroid/net/Uri;)Ljava/lang/String;",
        &[JValue::Object(uri)],
    ).ok()?.l().ok()?;

    if mime_obj.is_null() { return None; }

    let jstr: jni::objects::JString = mime_obj.into();
    let mime = env.get_string(&jstr).ok()?.to_string_lossy().into_owned();
    eprintln!("[content-uri] MIME type: {}", mime);

    // Map common MIME types to file extensions
    match mime.as_str() {
        "application/xml" | "text/xml" => Some("fdx".to_string()),
        "application/json" => Some("odraft".to_string()),
        "text/plain" => Some("txt".to_string()),
        "text/fountain" => Some("fountain".to_string()),
        "application/pdf" => Some("pdf".to_string()),
        _ => {
            // Try the sub-type as extension (e.g. "application/fdx" → "fdx")
            mime.rsplit('/').next().map(|s| s.to_string())
        }
    }
}

/// Read the data URI from the Android Activity's launching intent.
/// Called during setup to detect file-association cold starts on Android.
#[cfg(target_os = "android")]
fn android_get_intent_data() -> Option<String> {
    use jni::objects::JObject;
    use jni::JavaVM;

    // ndk_context::android_context() panics with "android context was not
    // initialized" if tao's Android glue has not registered the JNI VM yet.
    //
    // There is deliberately NO catch_unwind here. `[profile.release]` sets
    // `panic = "abort"`, so a panic aborts the process before any unwinding
    // happens and catch_unwind never gets to run — a guard here reads as
    // protection while providing none, which is worse than no guard at all.
    // The only real fix is not to call this before the context exists, so
    // every caller must run after the webview is up. See
    // `resolve_android_pending_file`.
    let ctx = android_context()?;
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    // activity.getIntent()
    let intent = env.call_method(&activity, "getIntent", "()Landroid/content/Intent;", &[])
        .ok()?.l().ok()?;
    if intent.is_null() { return None; }

    // intent.getData()
    let data = env.call_method(&intent, "getData", "()Landroid/net/Uri;", &[])
        .ok()?.l().ok()?;
    if data.is_null() { return None; }

    // uri.toString()
    let uri_obj = env.call_method(&data, "toString", "()Ljava/lang/String;", &[])
        .ok()?.l().ok()?;
    if uri_obj.is_null() { return None; }

    let jstr: jni::objects::JString = uri_obj.into();
    let java_str = env.get_string(&jstr).ok()?;
    let uri_string = java_str.to_string_lossy().into_owned();

    if uri_string.is_empty() { return None; }
    eprintln!("[file-assoc] Android intent data URI: {}", uri_string);
    Some(uri_string)
}

/// Extract a filename from a content:// URI string as fallback.
#[cfg(target_os = "android")]
fn extract_filename_from_uri(uri: &str) -> String {
    // Try to get the last path segment that looks like a filename
    if let Some(path) = uri.split('?').next() {
        if let Some(segment) = path.rsplit('/').next() {
            let decoded = percent_decode_str(segment).decode_utf8_lossy().to_string();
            if decoded.contains('.') {
                return decoded;
            }
        }
    }
    "Untitled.fdx".to_string()
}

// ── Android share sheet ──────────────────────────────────────────────────
// On Android, the Tauri save dialog doesn't work reliably (similar to iOS).
// Instead, we write to the cache directory and present an Android share
// intent so the user can save to Files, share via any app, etc.

/// Android export: write file to cache, then present a "Save As" document picker
/// via ACTION_CREATE_DOCUMENT.  The user picks a location and Android copies the
/// content from our temp file to the chosen URI via ContentResolver.
///
/// Falls back to ACTION_SEND share sheet if CREATE_DOCUMENT fails (e.g. no
/// document provider is available on the device).
#[cfg(target_os = "android")]
fn android_share_file(file_path: &str, mime_type: &str) -> Result<(), String> {
    use jni::objects::{JObject, JValue};
    use jni::JavaVM;

    let ctx = android_context().ok_or(NO_ANDROID_CONTEXT)?;
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("Failed to get JVM: {}", e))?;
    let mut env = vm.attach_current_thread()
        .map_err(|e| format!("Failed to attach JNI thread: {}", e))?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    // Store the temp file path so onActivityResult can copy it to the user's chosen location
    let path_jstr = env.new_string(file_path)
        .map_err(|e| format!("JNI new_string: {}", e))?;
    env.call_static_method(
        "com/proteus/opendraft/MainActivity",
        "setExportSourcePath",
        "(Ljava/lang/String;)V",
        &[JValue::Object(&JObject::from(path_jstr))],
    ).map_err(|e| format!("setExportSourcePath: {}", e))?;

    // Extract filename from path
    let filename = file_path.rsplit('/').next().unwrap_or("export");

    // Create Intent(ACTION_CREATE_DOCUMENT) — Android's native "Save As" dialog
    let action_str = env.new_string("android.intent.action.CREATE_DOCUMENT")
        .map_err(|e| format!("JNI new_string: {}", e))?;
    let intent = env.new_object("android/content/Intent", "(Ljava/lang/String;)V",
        &[JValue::Object(&JObject::from(action_str))])
        .map_err(|e| format!("new Intent: {}", e))?;

    // intent.addCategory(CATEGORY_OPENABLE)
    let cat_str = env.new_string("android.intent.category.OPENABLE")
        .map_err(|e| format!("JNI new_string: {}", e))?;
    let _ = env.call_method(&intent, "addCategory",
        "(Ljava/lang/String;)Landroid/content/Intent;",
        &[JValue::Object(&JObject::from(cat_str))])
        .map_err(|e| format!("addCategory: {}", e))?;

    // intent.setType(mimeType)
    let mime = env.new_string(mime_type)
        .map_err(|e| format!("JNI new_string: {}", e))?;
    let _ = env.call_method(&intent, "setType",
        "(Ljava/lang/String;)Landroid/content/Intent;",
        &[JValue::Object(&JObject::from(mime))])
        .map_err(|e| format!("setType: {}", e))?;

    // intent.putExtra(EXTRA_TITLE, filename) — suggested filename
    let extra_title = env.new_string("android.intent.extra.TITLE")
        .map_err(|e| format!("JNI new_string: {}", e))?;
    let filename_jstr = env.new_string(filename)
        .map_err(|e| format!("JNI new_string: {}", e))?;
    let _ = env.call_method(&intent, "putExtra",
        "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;",
        &[
            JValue::Object(&JObject::from(extra_title)),
            JValue::Object(&JObject::from(filename_jstr)),
        ])
        .map_err(|e| format!("putExtra TITLE: {}", e))?;

    // activity.startActivityForResult(intent, EXPORT_FILE_REQUEST=43)
    env.call_method(&activity, "startActivityForResult",
        "(Landroid/content/Intent;I)V",
        &[JValue::Object(&intent), JValue::Int(43)])
        .map_err(|e| format!("startActivityForResult: {}", e))?;

    eprintln!("[export] Launched save-as picker for {}", filename);
    Ok(())
}

#[tauri::command]
fn android_save_and_share(filename: String, contents: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let cache_dir = std::env::temp_dir();
        let path = cache_dir.join(&filename);
        std::fs::write(&path, &contents)
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        // Use application/octet-stream so Android's save-as dialog
        // preserves the exact filename without appending an extension
        android_share_file(&path.to_string_lossy(), "application/octet-stream")
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (filename, contents);
        Err("This command is only available on Android".to_string())
    }
}

#[tauri::command]
fn android_save_and_share_binary(filename: String, contents: Vec<u8>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let cache_dir = std::env::temp_dir();
        let path = cache_dir.join(&filename);
        std::fs::write(&path, &contents)
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        let mime = if filename.ends_with(".pdf") { "application/pdf" } else { "application/octet-stream" };
        android_share_file(&path.to_string_lossy(), mime)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (filename, contents);
        Err("This command is only available on Android".to_string())
    }
}

// ── Android native file picker ──────────────────────────────────────────
// Launches ACTION_OPEN_DOCUMENT intent so the user can pick a file.
// The result is captured by MainActivity.onActivityResult() and stored in
// a static companion field, then retrieved by android_get_picked_file().

#[tauri::command]
fn android_pick_file() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::{JObject, JValue};
        use jni::JavaVM;

        let ctx = android_context().ok_or(NO_ANDROID_CONTEXT)?;
        let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }
            .map_err(|e| format!("Failed to get JVM: {}", e))?;
        let mut env = vm.attach_current_thread()
            .map_err(|e| format!("Failed to attach JNI thread: {}", e))?;
        let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

        // Clear any previous picked file URI
        let null_obj = JObject::null();
        let _ = env.call_static_method(
            "com/proteus/opendraft/MainActivity",
            "setPickedFileUri",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&null_obj)],
        );

        // Create Intent(ACTION_OPEN_DOCUMENT)
        let action_str = env.new_string("android.intent.action.OPEN_DOCUMENT")
            .map_err(|e| format!("JNI new_string: {}", e))?;
        let intent = env.new_object(
            "android/content/Intent",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&JObject::from(action_str))],
        ).map_err(|e| format!("new Intent: {}", e))?;

        // intent.addCategory(CATEGORY_OPENABLE)
        let cat_str = env.new_string("android.intent.category.OPENABLE")
            .map_err(|e| format!("JNI new_string: {}", e))?;
        let _ = env.call_method(
            &intent, "addCategory",
            "(Ljava/lang/String;)Landroid/content/Intent;",
            &[JValue::Object(&JObject::from(cat_str))],
        ).map_err(|e| format!("addCategory: {}", e))?;

        // intent.setType("*/*") — accept all file types
        let mime_str = env.new_string("*/*")
            .map_err(|e| format!("JNI new_string: {}", e))?;
        let _ = env.call_method(
            &intent, "setType",
            "(Ljava/lang/String;)Landroid/content/Intent;",
            &[JValue::Object(&JObject::from(mime_str))],
        ).map_err(|e| format!("setType: {}", e))?;

        // Ask for durable read+write on whatever the user picks, so the same
        // document can be edited in place and saved back to — including after
        // a relaunch (issue #62's Android half).  MainActivity turns this into
        // a persisted grant via takePersistableUriPermission(); without the
        // flags here that call has nothing to persist.
        //   FLAG_GRANT_READ_URI_PERMISSION        = 0x00000001
        //   FLAG_GRANT_WRITE_URI_PERMISSION       = 0x00000002
        //   FLAG_GRANT_PERSISTABLE_URI_PERMISSION = 0x00000040
        let _ = env.call_method(
            &intent, "addFlags",
            "(I)Landroid/content/Intent;",
            &[JValue::Int(0x01 | 0x02 | 0x40)],
        ).map_err(|e| format!("addFlags: {}", e))?;

        // activity.startActivityForResult(intent, PICK_FILE_REQUEST=42)
        env.call_method(
            &activity, "startActivityForResult",
            "(Landroid/content/Intent;I)V",
            &[JValue::Object(&intent), JValue::Int(42)],
        ).map_err(|e| format!("startActivityForResult: {}", e))?;

        eprintln!("[file-picker] Launched document picker");
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("This command is only available on Android".to_string())
    }
}

/// Read and clear the picked file URI from the Activity's companion object.
/// Returns the content URI string, empty string if cancelled, or None if
/// the picker hasn't returned yet.
#[tauri::command]
fn android_get_picked_file() -> Option<String> {
    #[cfg(target_os = "android")]
    {
        android_read_and_clear_companion_field("getPickedFileUri", "setPickedFileUri")
    }
    #[cfg(not(target_os = "android"))]
    {
        None
    }
}

/// Check for a new intent URI from a warm-start "Open with" action.
/// Reads and clears newIntentUri from the Activity companion object,
/// and updates the PendingFile state so get_opened_file stays in sync.
#[tauri::command]
fn android_check_new_intent(state: tauri::State<PendingFile>) -> Option<String> {
    #[cfg(target_os = "android")]
    {
        let uri = android_read_and_clear_companion_field("getNewIntentUri", "setNewIntentUri");
        if let Some(ref u) = uri {
            eprintln!("[file-assoc] New intent detected: {}", u);
            // Update PendingFile so get_opened_file returns this URI
            *state.0.lock().unwrap() = Some(u.clone());
        }
        uri
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        None
    }
}

/// Helper: read a String? from a static getter on MainActivity and clear it via the setter.
#[cfg(target_os = "android")]
fn android_read_and_clear_companion_field(getter: &str, setter: &str) -> Option<String> {
    use jni::objects::{JObject, JString, JValue};
    use jni::JavaVM;

    let ctx = android_context()?;
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;

    let result = env.call_static_method(
        "com/proteus/opendraft/MainActivity",
        getter,
        "()Ljava/lang/String;",
        &[],
    ).ok()?.l().ok()?;

    if result.is_null() {
        return None;
    }

    let jstr: JString = result.into();
    let value = env.get_string(&jstr).ok()?.to_string_lossy().into_owned();

    // Clear the field
    let null_obj = JObject::null();
    let _ = env.call_static_method(
        "com/proteus/opendraft/MainActivity",
        setter,
        "(Ljava/lang/String;)V",
        &[JValue::Object(&null_obj)],
    );

    // Return Some even for empty string (signals cancellation for file picker)
    Some(value)
}

// ── iOS file helpers (Objective-C FFI) ────────────────────────────────────
// On iOS, files from the Files app or document picker require security-scoped
// URL access. These functions are defined in FileHelpers.m and linked into
// the iOS binary automatically via XcodeGen.

#[cfg(target_os = "ios")]
extern "C" {
    fn ios_present_share_sheet(file_path: *const std::ffi::c_char);
    fn ios_read_text_file(path: *const std::ffi::c_char) -> *mut std::ffi::c_char;
    fn ios_read_binary_file(path: *const std::ffi::c_char, out_len: *mut usize) -> *mut u8;
    fn ios_free_string(ptr: *mut std::ffi::c_char);
    fn ios_free_bytes(ptr: *mut u8);
    fn ios_copy_file_scoped(src: *const std::ffi::c_char, dst: *const std::ffi::c_char) -> i32;
    fn ios_pick_document();
    fn ios_get_picked_document() -> *mut std::ffi::c_char;
    fn ios_read_bookmarked_file(bookmark: *const std::ffi::c_char) -> *mut std::ffi::c_char;
    fn ios_read_bookmarked_bytes(
        bookmark: *const std::ffi::c_char,
        out_len: *mut usize,
    ) -> *mut u8;
    fn ios_write_bookmarked_bytes(
        bookmark: *const std::ffi::c_char,
        bytes: *const u8,
        len: usize,
    ) -> i32;
    fn ios_write_bookmarked_file(
        bookmark: *const std::ffi::c_char,
        contents: *const std::ffi::c_char,
    ) -> i32;
    fn ios_take_launch_file() -> *mut std::ffi::c_char;
    fn ios_discard_empty_scene();
    fn ios_activate_other_scene() -> i32;
    fn ios_connected_scene_ids() -> *mut std::ffi::c_char;
    fn ios_activate_scene_id(identifier: *const std::ffi::c_char) -> i32;
}

/// Take ownership of a string returned by the Objective-C helpers.
///
/// Every one of them hands back a `strdup`'d buffer that the caller owns, so
/// the free has to happen on this side; forgetting it leaks once per call.
#[cfg(target_os = "ios")]
unsafe fn take_ios_string(ptr: *mut std::ffi::c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    let owned = std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned();
    ios_free_string(ptr);
    Some(owned)
}

// ── iOS open-in-place commands ────────────────────────────────────────────
// Editing a screenplay where it lives — in Files, iCloud Drive or Dropbox —
// rather than importing a copy and exporting a new one (issue #62).
//
// The document is identified by a security-scoped bookmark rather than a path:
// a path from the picker is only readable while its scope grant is held, and
// the grant does not survive a relaunch.  A bookmark does, which is what makes
// "open on iPad, save, open again tomorrow" work.

/// Outcome of a document pick.
///
/// A tagged enum rather than `Option<Option<_>>`: serde renders both `None`
/// and `Some(None)` as JSON `null`, which would make "the picker is still
/// open" indistinguishable from "the user cancelled" and leave the frontend
/// polling forever.
#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
// Off iOS nothing constructs these — the command still has to name the type in
// its signature, so the enum stays compiled in and the variants read as dead.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
enum DocumentPickResult {
    /// The picker is still on screen.
    Pending,
    Cancelled,
    Picked {
        /// Base64 security-scoped bookmark — the document's durable identity.
        bookmark: String,
        /// File name, for the title bar and to decide which parser to use.
        name: String,
    },
}

/// Present the iOS document picker.  Returns immediately; the frontend polls
/// `ios_get_picked_document` for the result, as it does for Android's picker.
#[tauri::command]
fn ios_start_document_pick() -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        unsafe { ios_pick_document() };
        Ok(())
    }
    #[cfg(not(target_os = "ios"))]
    {
        Err("This command is only available on iOS".to_string())
    }
}

/// Poll for the picker's outcome. See {@link DocumentPickResult}.
#[tauri::command]
fn ios_poll_document_pick() -> Result<DocumentPickResult, String> {
    #[cfg(target_os = "ios")]
    {
        let raw = match unsafe { take_ios_string(ios_get_picked_document()) } {
            None => return Ok(DocumentPickResult::Pending),
            Some(s) => s,
        };
        if raw.is_empty() {
            return Ok(DocumentPickResult::Cancelled);
        }
        // "<base64 bookmark>\n<filename>" — base64 never contains a newline, so
        // splitting once keeps a name containing one intact.
        match raw.split_once('\n') {
            Some((bookmark, name)) => Ok(DocumentPickResult::Picked {
                bookmark: bookmark.to_string(),
                name: name.to_string(),
            }),
            None => Err("Malformed picker result".to_string()),
        }
    }
    #[cfg(not(target_os = "ios"))]
    {
        Err("This command is only available on iOS".to_string())
    }
}

/// Read the text of a bookmarked document.
#[tauri::command]
fn ios_read_in_place(bookmark: String) -> Result<String, String> {
    #[cfg(target_os = "ios")]
    {
        let c_bookmark = std::ffi::CString::new(bookmark.as_bytes())
            .map_err(|_| "Invalid bookmark".to_string())?;
        unsafe { take_ios_string(ios_read_bookmarked_file(c_bookmark.as_ptr())) }.ok_or_else(|| {
            "Could not open the file. It may have been moved, renamed, or deleted, \
             or its provider (such as Dropbox) may be offline."
                .to_string()
        })
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = bookmark;
        Err("This command is only available on iOS".to_string())
    }
}

/// Read a bookmarked document as raw bytes.
///
/// The archive formats — .fadein above all — are zip containers, and reading
/// one through the text path returns nothing at all, which is what made picking
/// a .fadein report that the file had been moved or deleted.
#[tauri::command]
fn ios_read_in_place_bytes(bookmark: String) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "ios")]
    {
        let c_bookmark = std::ffi::CString::new(bookmark.as_bytes())
            .map_err(|_| "Invalid bookmark".to_string())?;
        let mut len: usize = 0;
        let ptr = unsafe { ios_read_bookmarked_bytes(c_bookmark.as_ptr(), &mut len) };
        if ptr.is_null() {
            return Err("Could not open the file. It may have been moved, renamed, or deleted,                         or its provider (such as Dropbox) may be offline."
                .to_string());
        }
        let bytes = unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec();
        unsafe { ios_free_bytes(ptr) };
        Ok(bytes)
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = bookmark;
        Err("This command is only available on iOS".to_string())
    }
}

/// Write raw bytes back to a bookmarked document, replacing its contents.
#[tauri::command]
fn ios_write_in_place_bytes(bookmark: String, contents: Vec<u8>) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let c_bookmark = std::ffi::CString::new(bookmark.as_bytes())
            .map_err(|_| "Invalid bookmark".to_string())?;
        let ok = unsafe {
            ios_write_bookmarked_bytes(c_bookmark.as_ptr(), contents.as_ptr(), contents.len())
        };
        if ok == 1 {
            Ok(())
        } else {
            Err("Could not save to the original file. It may have been moved, renamed,                  or deleted, or its provider (such as Dropbox) may be offline."
                .to_string())
        }
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (bookmark, contents);
        Err("This command is only available on iOS".to_string())
    }
}

/// Write text back to a bookmarked document, replacing its contents.
#[tauri::command]
fn ios_write_in_place(bookmark: String, contents: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let c_bookmark = std::ffi::CString::new(bookmark.as_bytes())
            .map_err(|_| "Invalid bookmark".to_string())?;
        // A screenplay can legitimately contain no interior NULs, but reject
        // rather than truncate if one ever appears.
        let c_contents = std::ffi::CString::new(contents.as_bytes())
            .map_err(|_| "Document contains a null byte and cannot be written".to_string())?;
        let ok = unsafe { ios_write_bookmarked_file(c_bookmark.as_ptr(), c_contents.as_ptr()) };
        if ok == 1 {
            Ok(())
        } else {
            Err("Could not save to the original file. It may have been moved, renamed, \
                 or deleted, or its provider (such as Dropbox) may be offline."
                .to_string())
        }
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (bookmark, contents);
        Err("This command is only available on iOS".to_string())
    }
}

// ── iOS export commands ──────────────────────────────────────────────────
// On iOS, the native save dialog doesn't work reliably (files end up 0 bytes).
// Instead, we write to a temp file and present the iOS share sheet so the user
// can save to Files, AirDrop, etc.

#[tauri::command]
fn ios_save_and_share(filename: String, contents: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let temp_dir = std::env::temp_dir();
        let path = temp_dir.join(&filename);
        std::fs::write(&path, &contents)
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        let c_path = std::ffi::CString::new(path.to_string_lossy().as_bytes())
            .map_err(|e| format!("Invalid path: {}", e))?;
        unsafe { ios_present_share_sheet(c_path.as_ptr()); }
        Ok(())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (filename, contents);
        Err("This command is only available on iOS".to_string())
    }
}

#[tauri::command]
fn ios_save_and_share_binary(filename: String, contents: Vec<u8>) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let temp_dir = std::env::temp_dir();
        let path = temp_dir.join(&filename);
        std::fs::write(&path, &contents)
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        let c_path = std::ffi::CString::new(path.to_string_lossy().as_bytes())
            .map_err(|e| format!("Invalid path: {}", e))?;
        unsafe { ios_present_share_sheet(c_path.as_ptr()); }
        Ok(())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (filename, contents);
        Err("This command is only available on iOS".to_string())
    }
}

// ── Pending file state ────────────────────────────────────────────────────
// Stores the file path when the OS opens a screenplay file with OpenDraft.
// The frontend retrieves it on startup via the get_opened_file command.
struct PendingFile(Mutex<Option<String>>);

/// Extensions that OpenDraft can open via file association.
const OPENABLE_EXTENSIONS: &[&str] = &["fdx", "fountain", "fadein", "osf", "odraft", "txt"];

fn is_openable_file(path: &str) -> bool {
    let ext = path.rsplit('.').next().unwrap_or("");
    OPENABLE_EXTENSIONS.contains(&ext.to_lowercase().as_str())
}

/// Whether the Android launching intent has been consulted yet.
///
/// The intent is read once, lazily, rather than in setup() — see the comment
/// there. Reading it twice would re-open a file the user already dismissed.
#[cfg(target_os = "android")]
static ANDROID_INTENT_CHECKED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Read the launching intent the first time the frontend asks for a pending
/// file, by which point the webview exists and so does the Android context.
#[cfg(target_os = "android")]
fn resolve_android_pending_file(state: &tauri::State<PendingFile>) {
    use std::sync::atomic::Ordering;
    // swap, not load-then-store: two commands can race here on startup.
    if ANDROID_INTENT_CHECKED.swap(true, Ordering::AcqRel) {
        return;
    }
    let Some(uri) = android_get_intent_data() else { return };
    eprintln!("[file-assoc] Android launching intent: {}", uri);
    if let Ok(mut slot) = state.0.lock() {
        if slot.is_none() {
            *slot = Some(uri);
        }
    }
}

/// Collect a file the app was launched with by way of a scene connection.
///
/// Only reachable on iOS, and only since the scene manifest was added for
/// multi-window: UIKit stops calling application:openURL:options: once an app
/// declares scenes, so the launch URL is captured in FileHelpers.m instead.
/// Unlike Android's intent this needs no "already checked" flag — the
/// Objective-C side hands each captured file over exactly once.
#[cfg(target_os = "ios")]
fn resolve_ios_pending_file(state: &tauri::State<PendingFile>) {
    let Some(path) = (unsafe { take_ios_string(ios_take_launch_file()) }) else {
        return;
    };
    if !is_openable_file(&path) {
        eprintln!("[file-assoc] iOS launch file is not a screenplay: {}", path);
        return;
    }
    eprintln!("[file-assoc] iOS scene launch file: {}", path);
    if let Ok(mut slot) = state.0.lock() {
        if slot.is_none() {
            *slot = Some(path);
        }
    }
}

/// The file the OS asked OpenDraft to open, if one is waiting.
///
/// Taken rather than copied. Every window polls this as it mounts, so leaving
/// the path in place would make a second window open a duplicate of whatever
/// document the first one was launched with — which is exactly what "New
/// Window" is not for. The frontend already de-duplicates against the
/// `open-file` event, which carries the same path.
#[tauri::command]
fn get_opened_file(state: tauri::State<PendingFile>) -> Option<String> {
    #[cfg(target_os = "android")]
    resolve_android_pending_file(&state);
    #[cfg(target_os = "ios")]
    resolve_ios_pending_file(&state);

    state.0.lock().unwrap().take()
}

// ── File I/O commands ──────────────────────────────────────────────────────
// These bypass the fs plugin scope so the user can save/open files anywhere
// via the native dialog.

#[tauri::command]
fn save_text_to_path(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[tauri::command]
fn save_binary_to_path(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    #[cfg(not(target_os = "ios"))]
    {
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
    }
    #[cfg(target_os = "ios")]
    {
        // Try standard read first (works for files already in the sandbox)
        if let Ok(content) = std::fs::read_to_string(&path) {
            return Ok(content);
        }
        // Fallback: try reading via Foundation APIs with security-scoped access
        eprintln!("[read_text_file] std::fs failed, trying iOS security-scoped read: {}", path);
        let c_path = std::ffi::CString::new(path.as_bytes())
            .map_err(|_| format!("Invalid path: {}", path))?;
        let result = unsafe { ios_read_text_file(c_path.as_ptr()) };
        if result.is_null() {
            return Err(format!("Failed to read {}: Operation not permitted", path));
        }
        let content = unsafe { std::ffi::CStr::from_ptr(result) }
            .to_string_lossy()
            .into_owned();
        unsafe { ios_free_string(result); }
        Ok(content)
    }
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    #[cfg(not(target_os = "ios"))]
    {
        std::fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
    }
    #[cfg(target_os = "ios")]
    {
        // Works for anything already inside the sandbox, including the temp
        // copy the file-association path makes.
        if let Ok(bytes) = std::fs::read(&path) {
            return Ok(bytes);
        }
        // Same fallback read_text_file has always had, and for the same reason:
        // a document handed over by the Files app is only readable while its
        // security scope is held, which std::fs knows nothing about. Without
        // this a .fadein opened with "Open in OpenDraft" failed where a
        // .fountain from the same folder succeeded (issue #64).
        eprintln!(
            "[read_binary_file] std::fs failed, trying iOS security-scoped read: {}",
            path
        );
        let c_path = std::ffi::CString::new(path.as_bytes())
            .map_err(|_| format!("Invalid path: {}", path))?;
        let mut len: usize = 0;
        let ptr = unsafe { ios_read_binary_file(c_path.as_ptr(), &mut len) };
        if ptr.is_null() {
            return Err(format!("Failed to read {}: Operation not permitted", path));
        }
        let bytes = unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec();
        unsafe { ios_free_bytes(ptr) };
        Ok(bytes)
    }
}

// ── Backup folder commands ────────────────────────────────────────────────
// The automatic-backup feature writes timestamped .odraft snapshots to a folder
// the user picks, which is outside the fs plugin scope in
// capabilities/default.json. Like the commands above, these go through Rust
// deliberately rather than widening that scope.

#[derive(serde::Serialize)]
struct DirEntryInfo {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    /// Milliseconds since the Unix epoch; 0 when the platform won't say.
    modified_ms: u64,
}

/// List a directory, without recursing.
///
/// Entries whose metadata can't be read (a broken symlink, a file that vanished
/// mid-listing, a stale handle on a network share) are skipped rather than
/// failing the whole call — a single bad entry must not make the backup folder
/// look empty.
#[tauri::command]
fn list_dir_entries(path: String, extension: Option<String>) -> Result<Vec<DirEntryInfo>, String> {
    let want_ext = extension.map(|e| e.trim_start_matches('.').to_lowercase());
    let read = std::fs::read_dir(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;

    let mut out = Vec::new();
    for entry in read.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();

        if let Some(ref ext) = want_ext {
            let matches = std::path::Path::new(&name)
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase() == *ext)
                .unwrap_or(false);
            if !matches {
                continue;
            }
        }

        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        out.push(DirEntryInfo {
            name,
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified_ms,
        });
    }
    Ok(out)
}

#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create {}: {}", path, e))
}

/// Delete a single file. Refuses directories outright — the pruner runs
/// unattended against a user-chosen folder, so it must never be able to remove
/// a directory tree.
#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("Failed to stat {}: {}", path, e))?;
    if meta.is_dir() {
        return Err(format!("Refusing to delete directory {}", path));
    }
    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete {}: {}", path, e))
}

/// Write a text file atomically: write a sibling temp file, flush it to disk,
/// then rename over the target.
///
/// Used for snapshots instead of `save_text_to_path`. A backup truncated by a
/// crash, a full disk, or a yanked USB drive is worse than no backup at all —
/// the rename means a reader sees either the old snapshot or the new one, never
/// a half-written file. The temp file is created in the same directory so the
/// rename stays within one filesystem.
#[tauri::command]
fn save_text_atomic(path: String, contents: String) -> Result<(), String> {
    use std::io::Write;

    let target = std::path::Path::new(&path);
    let dir = target
        .parent()
        .ok_or_else(|| format!("Invalid path: {}", path))?;
    let tmp = target.with_extension(format!(
        "{}.tmp",
        target.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default()
    ));

    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;

    let write_result = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()
    })();

    if let Err(e) = write_result {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Failed to write {}: {}", tmp.display(), e));
    }

    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Failed to finalize {}: {}", path, e));
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct PathProbe {
    exists: bool,
    is_dir: bool,
    writable: bool,
    error: Option<String>,
}

/// Report whether a directory exists and can actually be written to.
///
/// Writability is determined by writing and deleting a probe file rather than
/// by inspecting permission bits, which lie on network mounts and under macOS
/// TCC. A missing or unwritable folder is *data*, not an error — the settings
/// UI needs to describe the problem, so `Err` is reserved for genuinely
/// unexpected failures.
#[tauri::command]
fn probe_directory(path: String) -> Result<PathProbe, String> {
    let p = std::path::Path::new(&path);
    let meta = match std::fs::metadata(p) {
        Ok(m) => m,
        Err(e) => {
            return Ok(PathProbe {
                exists: false,
                is_dir: false,
                writable: false,
                error: Some(e.to_string()),
            })
        }
    };

    if !meta.is_dir() {
        return Ok(PathProbe {
            exists: true,
            is_dir: false,
            writable: false,
            error: Some("Not a folder".into()),
        });
    }

    let probe = p.join(format!(".opendraft-write-test-{}", std::process::id()));
    match std::fs::write(&probe, b"ok") {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            Ok(PathProbe { exists: true, is_dir: true, writable: true, error: None })
        }
        Err(e) => Ok(PathProbe {
            exists: true,
            is_dir: true,
            writable: false,
            error: Some(e.to_string()),
        }),
    }
}

/// Reveal a file or folder in the OS file manager.
#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    // Same sanitation as open_url: reject control characters, and always pass
    // the path as a separate argument so nothing reaches a shell.
    if path.is_empty() || path.chars().any(|c| c.is_control()) {
        return Err("Invalid path".into());
    }

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg("-R").arg(&path).spawn();

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer")
        .arg(format!("/select,{}", path))
        .spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = {
        let dir = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::path::PathBuf::from(&path));
        std::process::Command::new("xdg-open").arg(dir).spawn()
    };

    result
        .map(|_| ())
        .map_err(|e| format!("Failed to reveal {}: {}", path, e))
}

// ── Generic HTTP fetch command ────────────────────────────────────────────
// Makes HTTP requests from Rust, bypassing WebView mixed-content restrictions.
// The Tauri WebView loads from https://tauri.localhost, so browser fetch() to
// plain http:// addresses (collab server, local backends) is blocked.

#[derive(serde::Serialize)]
struct HttpFetchResponse {
    status: u16,
    body: String,
}

#[tauri::command]
async fn http_fetch(
    url: String,
    method: Option<String>,
    body: Option<String>,
    content_type: Option<String>,
    authorization: Option<String>,
) -> Result<HttpFetchResponse, String> {
    let method_str = method.as_deref().unwrap_or("GET");
    eprintln!("[http_fetch] {} {}", method_str, url);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| {
            eprintln!("[http_fetch] Client build error: {}", e);
            format!("HTTP client error: {}", e)
        })?;

    let req_method = method_str.parse::<reqwest::Method>()
        .map_err(|e| format!("Invalid method '{}': {}", method_str, e))?;

    let mut req = client.request(req_method, &url);

    if let Some(ct) = &content_type {
        req = req.header("Content-Type", ct.as_str());
    }

    if let Some(auth) = &authorization {
        req = req.header("Authorization", auth.as_str());
    }

    if let Some(b) = &body {
        req = req.body(b.clone());
    }

    let resp = req.send().await
        .map_err(|e| {
            eprintln!("[http_fetch] {} {} → FAILED: {}", method_str, url, e);
            format!("Request to {} failed: {}", url, e)
        })?;

    let status = resp.status().as_u16();
    let body_text = resp.text().await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    eprintln!("[http_fetch] {} {} → {} ({} bytes)", method_str, url, status, body_text.len());

    Ok(HttpFetchResponse {
        status,
        body: body_text,
    })
}

// ── Link preview command ───────────────────────────────────────────────────
// Fetches a URL and extracts Open Graph metadata. Used by the editor's link
// preview feature. Runs in Rust to avoid CORS issues that browser fetch has.

#[derive(serde::Serialize)]
struct LinkPreview {
    url: String,
    title: String,
    description: String,
    image: String,
    site_name: String,
}

#[tauri::command]
async fn fetch_link_preview(url: String) -> Result<LinkPreview, String> {
    let html = fetch_url_body(&url).await.map_err(|e| format!("Failed to fetch {}: {}", url, e))?;

    let title = extract_og_tag(&html, "og:title")
        .or_else(|| extract_html_title(&html))
        .unwrap_or_default();
    let description = extract_og_tag(&html, "og:description")
        .or_else(|| extract_meta_description(&html))
        .unwrap_or_default();
    let image = extract_og_tag(&html, "og:image").unwrap_or_default();
    let site_name = extract_og_tag(&html, "og:site_name").unwrap_or_default();

    Ok(LinkPreview { url, title, description, image, site_name })
}

/// Fetch URL body using reqwest (works on all platforms including iOS/Android).
/// Times out after 5 seconds.
async fn fetch_url_body(url: &str) -> Result<String, Box<dyn std::error::Error>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .user_agent("Mozilla/5.0 (compatible; OpenDraft/1.0)")
        .build()?;

    let resp = client.get(url).send().await?;
    let body = resp.text().await?;
    Ok(body)
}

/// Extract an Open Graph meta tag value from HTML.
fn extract_og_tag(html: &str, property: &str) -> Option<String> {
    // Match: <meta property="og:title" content="...">
    // Also match: <meta content="..." property="og:title">
    let lower = html.to_lowercase();
    let prop_pattern = format!("property=\"{}\"", property);

    // Find the meta tag containing this property
    let mut search_from = 0;
    while let Some(meta_start) = lower[search_from..].find("<meta ") {
        let abs_start = search_from + meta_start;
        let tag_end = match lower[abs_start..].find('>') {
            Some(pos) => abs_start + pos,
            None => break,
        };
        let tag = &html[abs_start..=tag_end];
        let tag_lower = &lower[abs_start..=tag_end];

        if tag_lower.contains(&prop_pattern) {
            if let Some(content) = extract_attr(tag, "content") {
                return Some(decode_html_entities(&content));
            }
        }
        search_from = tag_end + 1;
    }
    None
}

/// Extract the <title> tag content.
fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title")?.checked_add(lower[lower.find("<title")?..].find('>')?)?;
    let content_start = start + 1;
    let end = lower[content_start..].find("</title>")?;
    let title = html[content_start..content_start + end].trim();
    if title.is_empty() { None } else { Some(decode_html_entities(title)) }
}

/// Extract <meta name="description" content="...">.
fn extract_meta_description(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let mut search_from = 0;
    while let Some(meta_start) = lower[search_from..].find("<meta ") {
        let abs_start = search_from + meta_start;
        let tag_end = match lower[abs_start..].find('>') {
            Some(pos) => abs_start + pos,
            None => break,
        };
        let tag = &html[abs_start..=tag_end];
        let tag_lower = &lower[abs_start..=tag_end];

        if tag_lower.contains("name=\"description\"") {
            if let Some(content) = extract_attr(tag, "content") {
                return Some(decode_html_entities(&content));
            }
        }
        search_from = tag_end + 1;
    }
    None
}

/// Extract an HTML attribute value (case-insensitive attribute name).
fn extract_attr(tag: &str, attr_name: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let pattern = format!("{}=\"", attr_name);
    let start = lower.find(&pattern)? + pattern.len();
    let end = lower[start..].find('"')? + start;
    Some(tag[start..end].to_string())
}

/// Decode common HTML entities.
fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

/// Guess MIME type from file extension.
fn guess_mime(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("pdf") => "application/pdf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("json") => "application/json",
        Some("txt") => "text/plain",
        _ => "application/octet-stream",
    }
}

// ── New window command (for multi-instance support) ──────────────────────
// Each WebviewWindow gets its own JS context, so editor state is independent.
use std::sync::atomic::{AtomicU32, AtomicBool, Ordering};
/// Android numbers its windows by Activity slot instead — see open_new_window.
#[cfg_attr(target_os = "android", allow(dead_code))]
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);
/// Set to true once the main window has finished loading.
/// Used to distinguish cold-start file opens (load into main window)
/// from warm-start file opens (open in a new window).
static APP_READY: AtomicBool = AtomicBool::new(false);

/// When this launch began, for telling startup's own scene request apart from
/// the writer's (see startup_scene_artifact).
#[cfg(target_os = "ios")]
static STARTED_AT: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// Whether a scene request is the one startup leaves behind rather than a
/// window somebody actually wants.
///
/// Creating the main window is enough on its own to make tao ask the system for
/// a scene it then does not use — see ios_discard_empty_scene for why. That
/// request is always the first, and always arrives within moments of launch. A
/// later one is iPadOS passing on something the writer did (dragging the app
/// into Split View, "Open in New Window"), and has to be honoured.
///
/// The time bound is what keeps this honest if a future tao stops asking: the
/// expectation expires instead of eating the first real request of the session.
#[cfg(target_os = "ios")]
fn startup_scene_artifact() -> bool {
    static EXPECTED: AtomicBool = AtomicBool::new(true);
    const STARTUP_WINDOW: std::time::Duration = std::time::Duration::from_secs(15);

    let Some(started) = STARTED_AT.get() else {
        return false;
    };
    if started.elapsed() > STARTUP_WINDOW {
        return false;
    }
    EXPECTED.swap(false, Ordering::AcqRel)
}

/// Update the native window title and refresh the Window menu list.
/// Called from the frontend whenever the document title changes.
#[tauri::command]
async fn set_window_title(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let display_title = if title.is_empty() { "OpenDraft".to_string() } else { format!("{} — OpenDraft", title) };
        window.set_title(&display_title).map_err(|e| format!("{}", e))?;
        // Rebuild the Window menu to reflect current window titles
        let app = window.app_handle();
        if let Some(menu) = app.menu() {
            rebuild_window_menu(app, &menu);
        }
    }
    #[cfg(not(desktop))]
    { let _ = (window, title); }
    Ok(())
}

/// Open a URL in the user's default browser.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // Only allow http/https URLs
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only http and https URLs are allowed".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }
    Ok(())
}

/// Rebuild the Window menu: standard items + list of all open windows.
#[cfg(desktop)]
fn rebuild_window_menu(app: &tauri::AppHandle, _menu: &Menu<tauri::Wry>) {
    #[cfg(not(target_os = "macos"))]
    return;

    #[cfg(target_os = "macos")]
    {
        // Build a fresh Window submenu with standard items + window list
        let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = vec![
            Box::new(PredefinedMenuItem::minimize(app, None).unwrap()),
            Box::new(PredefinedMenuItem::maximize(app, None).unwrap()),
            Box::new(PredefinedMenuItem::separator(app).unwrap()),
            Box::new(PredefinedMenuItem::close_window(app, None).unwrap()),
        ];

        // Add all open windows
        let windows = app.webview_windows();
        let mut win_entries: Vec<_> = windows.iter()
            .filter(|(label, _)| *label != "splashscreen")
            .collect();
        win_entries.sort_by_key(|(label, _)| label.clone());

        if !win_entries.is_empty() {
            items.push(Box::new(PredefinedMenuItem::separator(app).unwrap()));
            for (label, win) in &win_entries {
                let title = win.title().unwrap_or_else(|_| (*label).clone());
                let item_id = format!("window-list-{}", label);
                if let Ok(mi) = MenuItem::with_id(app, &item_id, &title, true, None::<&str>) {
                    items.push(Box::new(mi));
                }
            }
        }

        // Convert to references for Submenu::with_items
        let item_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items.iter()
            .map(|b| b.as_ref())
            .collect();

        if let Ok(new_window_sub) = Submenu::with_items(app, "Window", true, &item_refs) {
            // Replace the Window submenu in the app menu
            if let Some(menu) = app.menu() {
                // Remove old Window submenu and append new one
                if let Ok(menu_items) = menu.items() {
                    for item in &menu_items {
                        if let tauri::menu::MenuItemKind::Submenu(sub) = item {
                            if sub.text().unwrap_or_default() == "Window" {
                                let _ = menu.remove(item);
                                break;
                            }
                        }
                    }
                }
                let _ = menu.append(&new_window_sub);
            }
        }
    }
}

/// Whether a second window is something this device can actually show.
///
/// Always true on desktop. On iPadOS it reports `UIApplication.supportsMultiple
/// Scenes`, which is false on iPhone — there a new window would be attached to
/// the one scene and simply cover the document the writer was editing, with no
/// way back. Android needs API 32+, where the system can put two of the app's
/// activities on screen at once.
///
/// The menu hides "New Window" when this is false, and open_new_window refuses,
/// so neither path can strand the user in a window they cannot leave.
#[tauri::command]
async fn supports_multiple_windows(app: tauri::AppHandle) -> bool {
    app.supports_multiple_windows()
}

/// Number of extra activities declared in AndroidManifest.xml (WindowActivity1
/// upwards). Android identifies a window by its activity *class*, so the ceiling
/// is however many classes the manifest declares — see android-src/.
#[cfg(target_os = "android")]
const ANDROID_EXTRA_WINDOWS: u32 = 3;

/// One of the app's open windows, for the "already open over there" prompt.
#[derive(serde::Serialize)]
struct WindowInfo {
    label: String,
    title: String,
}

// ── Which iPadOS scene each window lives in ───────────────────────────────
//
// tao's scene delegate ignores sceneDidDisconnect, so closing a window with the
// iPadOS window control leaves it in Tauri's list — alive as far as the app is
// concerned, and gone as far as the writer is concerned. That is not a cosmetic
// difference: the frontend uses that list to decide whether a screenplay is
// still open somewhere, so a closed window went on claiming its document
// forever. Reopening the file said "already open in another window", and
// switching to it then reported that the window was gone.
//
// So the app keeps its own map. A window's scene is bound shortly after it is
// created (the scene is requested from the system and arrives asynchronously,
// so this cannot be read straight after build()), and a window whose scene has
// since disconnected is treated as closed.

#[cfg(target_os = "ios")]
static WINDOW_SCENES: Mutex<Option<std::collections::BTreeMap<String, String>>> =
    Mutex::new(None);

/// Identifiers of every window scene the system currently has connected.
#[cfg(target_os = "ios")]
fn connected_scene_ids() -> Vec<String> {
    let Some(joined) = (unsafe { take_ios_string(ios_connected_scene_ids()) }) else {
        return Vec::new();
    };
    joined
        .split(',')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

/// Remember which scene a newly created window landed in.
///
/// Retried rather than read once: the scene is requested from the system and
/// connects a moment later, and the window is attached to it only then. The
/// free scene is the one no window has claimed yet — windows are created one at
/// a time, in response to a person, so there is never a second candidate.
#[cfg(target_os = "ios")]
fn bind_window_scene(label: String) {
    std::thread::spawn(move || {
        for delay_ms in [300, 700, 1500, 3000] {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));

            let ids = connected_scene_ids();
            if ids.is_empty() {
                continue;
            }
            let mut guard = match WINDOW_SCENES.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            let map = guard.get_or_insert_with(Default::default);
            if map.contains_key(&label) {
                return;
            }
            let taken: std::collections::BTreeSet<&String> = map.values().collect();
            if let Some(free) = ids.iter().find(|id| !taken.contains(id)) {
                eprintln!("[multi-window] {} is in scene {}", label, free);
                map.insert(label, free.clone());
                return;
            }
        }
        eprintln!("[multi-window] could not tell which scene {} landed in", label);
    });
}

/// Labels whose scene has gone away, and which are therefore closed windows.
#[cfg(target_os = "ios")]
fn ghost_window_labels() -> Vec<String> {
    let ids = connected_scene_ids();
    // No answer from UIKit is not evidence that every window has closed.
    if ids.is_empty() {
        return Vec::new();
    }
    let Ok(mut guard) = WINDOW_SCENES.lock() else {
        return Vec::new();
    };
    let Some(map) = guard.as_mut() else {
        return Vec::new();
    };

    let ghosts: Vec<String> = map
        .iter()
        .filter(|(_, scene)| !ids.contains(scene))
        .map(|(label, _)| label.clone())
        .collect();
    for label in &ghosts {
        map.remove(label);
    }
    ghosts
}

/// The windows that exist right now.
///
/// The frontend keeps its own note of which document each window is showing,
/// but it cannot tell a window that closed from one that is still open — that
/// answer only exists here. Anything not in this list is a stale note.
#[tauri::command]
async fn list_windows(app: tauri::AppHandle) -> Vec<WindowInfo> {
    app.webview_windows()
        .iter()
        .filter(|(label, _)| *label != "splashscreen")
        .map(|(label, window)| WindowInfo {
            label: label.clone(),
            title: window.title().unwrap_or_else(|_| label.clone()),
        })
        .collect()
}

/// Bring a window to the front.
///
/// The answer to "this screenplay is already open in another window" — the one
/// that avoids a second editor autosaving over the first.
#[tauri::command]
async fn focus_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| "That window has since been closed.".to_string())?;

    #[cfg(desktop)]
    {
        let _ = window.unminimize();
        let _ = window.show();
        window
            .set_focus()
            .map_err(|e| format!("Could not switch windows: {}", e))?;
    }
    // On iPadOS a window is a scene, and only the system can move one to the
    // front — asking is the whole of the API.
    #[cfg(target_os = "ios")]
    {
        let _ = &window;
        let scene = WINDOW_SCENES
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().and_then(|map| map.get(&label).cloned()));

        let activated = match scene {
            Some(id) => {
                let c_id = std::ffi::CString::new(id).map_err(|_| "Invalid scene id".to_string())?;
                unsafe { ios_activate_scene_id(c_id.as_ptr()) }
            }
            // No mapping — the window predates the map, or its scene never
            // reported in. "The window that is not this one" is right whenever
            // there are two, which is the case this prompt is about.
            None => unsafe { ios_activate_other_scene() },
        };
        if activated != 1 {
            return Err(
                "The other window is no longer open. Use the app switcher to find it.".to_string(),
            );
        }
    }
    // Android has no equivalent: an Activity cannot pull itself to the front
    // without an intent from the one that started it, and tao does not expose
    // that. The prompt still says where the document is; the writer switches
    // with the platform's own app switcher.
    #[cfg(target_os = "android")]
    {
        let _ = &window;
        return Err("Switch windows using the Android app switcher.".to_string());
    }
    #[cfg(not(target_os = "android"))]
    Ok(())
}

#[tauri::command]
async fn open_new_window(app: tauri::AppHandle) -> Result<(), String> {
    if !app.supports_multiple_windows() {
        return Err("This device can only show one OpenDraft window at a time.".to_string());
    }

    // Android identifies a window by its Activity class, so the label is tied to
    // a numbered slot rather than to a counter that only ever climbs: closing
    // the second window has to give WindowActivity1 back, or a writer who opens
    // and closes windows a few times runs out of them.
    #[cfg(target_os = "android")]
    let label = {
        let open = app.webview_windows();
        let slot = (1..=ANDROID_EXTRA_WINDOWS)
            .find(|n| !open.contains_key(&format!("main-{}", n)))
            .ok_or_else(|| {
                format!(
                    "OpenDraft can have {} windows open at once on Android.",
                    ANDROID_EXTRA_WINDOWS + 1
                )
            })?;
        format!("main-{}", slot)
    };
    #[cfg(not(target_os = "android"))]
    let label = format!("main-{}", WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed));

    // Use "/" so BrowserRouter matches the root route (not "/index.html")
    let url = tauri::WebviewUrl::App("/".into());
    // iOS adds nothing to the builder; the platform blocks below are what use
    // the binding, so on iOS it reads as an unnecessary `mut`.
    #[allow(unused_mut)]
    let mut builder = tauri::WebviewWindowBuilder::new(&app, &label, url);
    // .title(), .inner_size(), .min_inner_size(), .resizable() are desktop-only
    #[cfg(desktop)]
    {
        builder = builder
            .title("OpenDraft")
            .inner_size(1280.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .resizable(true);
    }
    // iOS needs nothing here: a window built without a scene of its own asks the
    // system for one, which is exactly what a new iPad window is. On Android the
    // window *is* an Activity, so it has to name a class the manifest declares.
    #[cfg(target_os = "android")]
    {
        builder = builder.activity_name(label.replace("main-", "WindowActivity"));
    }
    builder.build()
        .map_err(|e| format!("Failed to create window: {}", e))?;
    #[cfg(target_os = "ios")]
    bind_window_scene(label.clone());
    // Refresh window list in the Window menu
    #[cfg(desktop)]
    if let Some(menu) = app.menu() {
        rebuild_window_menu(&app, &menu);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "ios")]
    let _ = STARTED_AT.set(std::time::Instant::now());

    let builder = tauri::Builder::default()
        // ── Plugins (available on all platforms) ────────────────────────
        .plugin(
            tauri_plugin_sql::Builder::default()
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        // ── Asset protocol: serve local files for convertFileSrc() URLs ──
        .register_uri_scheme_protocol("asset", |_app, request| {
            let uri = request.uri();
            let raw_path = uri.path();
            // Decode percent-encoded path and strip leading slash
            let decoded = percent_decode_str(raw_path).decode_utf8_lossy();
            let file_path_str = decoded.trim_start_matches('/');
            let file_path = std::path::Path::new(file_path_str);

            // Build a Response without unwrapping — a panic here aborts the
            // whole process because [profile.release] panic = "abort".
            let build_response = |status: u16, mime: &str, body: Vec<u8>| {
                tauri::http::Response::builder()
                    .status(status)
                    .header("Content-Type", mime)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(body)
                    .unwrap_or_else(|_| {
                        tauri::http::Response::new(Vec::new())
                    })
            };
            match std::fs::read(file_path) {
                Ok(data) => build_response(200, guess_mime(file_path), data),
                Err(e) => {
                    eprintln!("[asset] Failed to read {}: {}", file_path_str, e);
                    build_response(404, "text/plain", Vec::new())
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            save_text_to_path,
            save_binary_to_path,
            read_text_file,
            read_binary_file,
            list_dir_entries,
            ensure_dir,
            delete_file,
            save_text_atomic,
            probe_directory,
            reveal_path,
            http_fetch,
            fetch_link_preview,
            get_opened_file,
            read_content_uri,
            read_content_uri_bytes,
            write_content_uri,
            write_content_uri_bytes,
            ios_save_and_share,
            ios_save_and_share_binary,
            ios_start_document_pick,
            ios_poll_document_pick,
            ios_read_in_place,
            ios_write_in_place,
            ios_read_in_place_bytes,
            ios_write_in_place_bytes,
            android_save_and_share,
            android_save_and_share_binary,
            android_pick_file,
            android_get_picked_file,
            android_check_new_intent,
            open_new_window,
            supports_multiple_windows,
            list_windows,
            focus_window,
            set_window_title,
            open_url,
        ]);

        // ── Native menu (desktop only) ────────────────────────────────
        // macOS: App menu + Edit menu (Cmd+C/V/X/A/Z) + Window menu.
        //        The Edit menu is required for clipboard & undo shortcuts
        //        to reach the webview on macOS.
        // Windows/Linux: empty menu — no native menu bar shown.
        // Mobile (iOS/Android): no menu support — .menu() is not available.
        #[cfg(desktop)]
        let builder = builder.menu(|app_handle| {
            #[cfg(target_os = "macos")]
            {
                let app_submenu = Submenu::with_items(
                    app_handle,
                    "OpenDraft",
                    true,
                    &[
                        &PredefinedMenuItem::about(app_handle, Some("About OpenDraft"), None)?,
                        &PredefinedMenuItem::separator(app_handle)?,
                        &PredefinedMenuItem::services(app_handle, None)?,
                        &PredefinedMenuItem::separator(app_handle)?,
                        &PredefinedMenuItem::hide(app_handle, None)?,
                        &PredefinedMenuItem::hide_others(app_handle, None)?,
                        &PredefinedMenuItem::show_all(app_handle, None)?,
                        &PredefinedMenuItem::separator(app_handle)?,
                        &PredefinedMenuItem::quit(app_handle, None)?,
                    ],
                )?;
                let edit_submenu = Submenu::with_items(
                    app_handle,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(app_handle, None)?,
                        &PredefinedMenuItem::redo(app_handle, None)?,
                        &PredefinedMenuItem::separator(app_handle)?,
                        &PredefinedMenuItem::cut(app_handle, None)?,
                        &PredefinedMenuItem::copy(app_handle, None)?,
                        &PredefinedMenuItem::paste(app_handle, None)?,
                        &PredefinedMenuItem::select_all(app_handle, None)?,
                    ],
                )?;
                let window_submenu = Submenu::with_items(
                    app_handle,
                    "Window",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(app_handle, None)?,
                        &PredefinedMenuItem::maximize(app_handle, None)?,
                        &PredefinedMenuItem::separator(app_handle)?,
                        &PredefinedMenuItem::close_window(app_handle, None)?,
                    ],
                )?;
                Menu::with_items(app_handle, &[&app_submenu, &edit_submenu, &window_submenu])
            }
            #[cfg(not(target_os = "macos"))]
            {
                Menu::new(app_handle)
            }
        });

    let builder = builder.setup(|app| {
            // Ensure user data directory exists
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");
            std::fs::create_dir_all(&app_data_dir).ok();

            eprintln!("OpenDraft starting — local SQLite storage");
            eprintln!("Data dir: {}", app_data_dir.display());

            // ── Check for file association launch ──────────────────────────
            // `mut` is used on desktop, which fills this from the CLI args
            // below. Android resolves its intent lazily instead, so nothing
            // writes to it there.
            #[allow(unused_mut)]
            let mut pending: Option<String> = None;

            // Windows/Linux: check CLI args
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                let args: Vec<String> = std::env::args().collect();
                if args.len() > 1 {
                    let path = &args[1];
                    if is_openable_file(path) && std::path::Path::new(path).is_file() {
                        eprintln!("File association launch: {}", path);
                        pending = Some(path.clone());
                    }
                }
            }

            // Android's launching intent is deliberately NOT read here.
            //
            // setup() runs before tao's Android glue has registered the JNI VM,
            // so ndk_context::android_context() panics with "android context
            // was not initialized" — and `panic = "abort"` turns that into a
            // SIGABRT that kills the app on every cold start. (tao 0.34 happened
            // to initialize early enough for this to work; 0.35 does not.)
            //
            // The intent is read lazily instead, on the first get_opened_file
            // call, which can only arrive once the webview is running and the
            // context therefore exists.

            // Clone before moving into managed state (needed for Android re-emit)
            #[cfg(target_os = "android")]
            let android_pending = pending.clone();

            app.manage(PendingFile(Mutex::new(pending)));

            // The main window is in the first scene; binding it now means the
            // map covers every window, so a closed one can always be told from
            // an open one (see WINDOW_SCENES).
            #[cfg(target_os = "ios")]
            bind_window_scene("main".to_string());

            // Android: emit open-file events with delays for the JS listener
            // (RunEvent::Opened is not available on Android)
            #[cfg(target_os = "android")]
            {
                if let Some(uri) = android_pending {
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        for delay_ms in [500, 1500, 3000] {
                            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                            eprintln!("[file-assoc] Android re-emit open-file after {}ms", delay_ms);
                            let _ = handle.emit_to("main", "open-file", &uri);
                        }
                    });
                }
            }

            // ── Desktop: show splash then transition to main window ───
            #[cfg(not(target_os = "ios"))]
            #[cfg(not(target_os = "android"))]
            {
                let splash = app.get_webview_window("splashscreen");
                let main_window = app.get_webview_window("main");

                std::thread::spawn(move || {
                    // Brief splash display — no backend to wait for
                    std::thread::sleep(std::time::Duration::from_millis(500));

                    if let Some(main) = main_window {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                    if let Some(sp) = splash {
                        let _ = sp.close();
                    }
                    // Mark app as ready — subsequent file opens go to new windows
                    APP_READY.store(true, Ordering::Release);
                });
            }

            Ok(())
        });

    // Handle Window menu clicks to focus the selected window
    #[cfg(desktop)]
    let builder = builder.on_menu_event(|app, event| {
        let id = event.id().0.as_str();
        if let Some(label) = id.strip_prefix("window-list-") {
            if let Some(win) = app.get_webview_window(label) {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    })
    .on_window_event(|window, event| {
        if let tauri::WindowEvent::Destroyed = event {
            let app = window.app_handle();
            if let Some(menu) = app.menu() {
                rebuild_window_menu(app, &menu);
            }
        }
    });

    let app = builder
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            let msg = format!("FATAL: Failed to build Tauri app: {}", e);
            eprintln!("{}", msg);
            let _ = std::fs::write("/tmp/opendraft_crash.log", &msg);
            panic!("{}", msg);
        });

    app.run(|_app_handle, _event| {
        // ── A window for a scene the system asked for (iPad, issue #63) ──
        //
        // Fires when iPadOS creates a scene OpenDraft did not ask for itself:
        // dragging the app icon into Split View, "Open in New Window" from the
        // app switcher, or a second document opened from Files. The scene
        // arrives empty and stays blank unless a window is built for it — tao
        // attaches the next window created to the waiting scene.
        //
        // Windows opened from inside the app go through open_new_window and are
        // not reported here.
        #[cfg(target_os = "ios")]
        if let tauri::RunEvent::SceneRequested { .. } = &_event {
            // Startup asks the system for one scene it turns out not to need —
            // see ios_discard_empty_scene. Filling it would greet the writer
            // with two windows of the same blank screenplay on every launch,
            // and with two connections to the local database, which is what
            // "database is locked" on first run was.
            if startup_scene_artifact() {
                eprintln!("[multi-window] ignoring the scene left over from startup");
                unsafe { ios_discard_empty_scene() };
                return;
            }

            let count = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
            let label = format!("main-{}", count);
            eprintln!("[multi-window] scene requested, building window {}", label);
            let url = tauri::WebviewUrl::App("/".into());
            match tauri::WebviewWindowBuilder::new(_app_handle, &label, url).build() {
                Ok(_) => bind_window_scene(label.clone()),
                // The scene is left blank rather than the app taken down: the
                // window the user already had keeps working.
                Err(e) => eprintln!("[multi-window] failed to build window for scene: {}", e),
            }
        }

        // ── Handle file association open events (macOS + iOS) ──────
        // Note: Android does NOT support RunEvent::Opened — intent data is
        // handled in setup() via android_get_intent_data() instead.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &_event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let mut path_str = path.to_string_lossy().to_string();
                    if !is_openable_file(&path_str) {
                        continue;
                    }

                    // On iOS, copy the file to the app's temp directory using
                    // security-scoped access. Files from the Files app require
                    // startAccessingSecurityScopedResource before reading/copying.
                    // Files from WhatsApp etc. land in Documents/Inbox (already
                    // in sandbox) so the copy succeeds either way.
                    #[cfg(target_os = "ios")]
                    {
                        let temp_dir = std::env::temp_dir();
                        let fname = path.file_name().unwrap_or_default();
                        let temp_path = temp_dir.join(fname);
                        let c_src = std::ffi::CString::new(path_str.as_bytes()).ok();
                        let c_dst = std::ffi::CString::new(temp_path.to_string_lossy().as_bytes()).ok();
                        let copied = match (c_src, c_dst) {
                            (Some(src), Some(dst)) => unsafe {
                                ios_copy_file_scoped(src.as_ptr(), dst.as_ptr()) == 1
                            },
                            _ => false,
                        };
                        if copied {
                            eprintln!("[file-assoc] iOS: copied to sandbox temp: {}", temp_path.display());
                            path_str = temp_path.to_string_lossy().to_string();
                        } else {
                            eprintln!("[file-assoc] iOS: scoped copy failed, trying std::fs::copy");
                            match std::fs::copy(&path, &temp_path) {
                                Ok(_) => {
                                    eprintln!("[file-assoc] iOS: std::fs::copy succeeded: {}", temp_path.display());
                                    path_str = temp_path.to_string_lossy().to_string();
                                }
                                Err(e) => {
                                    eprintln!("[file-assoc] iOS: all copy attempts failed ({}), using original", e);
                                }
                            }
                        }
                    }

                    eprintln!("[file-assoc] RunEvent::Opened: {}", path_str);

                    // Desktop warm start: open file in a new window
                    #[cfg(desktop)]
                    if APP_READY.load(Ordering::Acquire) {
                        eprintln!("[file-assoc] App already running — opening in new window");
                        let count = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
                        let label = format!("main-{}", count);
                        let url = tauri::WebviewUrl::App("/".into());
                        match tauri::WebviewWindowBuilder::new(_app_handle, &label, url)
                            .title("OpenDraft")
                            .inner_size(1280.0, 800.0)
                            .min_inner_size(800.0, 600.0)
                            .resizable(true)
                            .build()
                        {
                            Ok(_new_win) => {
                                // Use emit_to with the label to target ONLY the new window.
                                // WebviewWindow::emit() broadcasts to all windows.
                                let handle = _app_handle.clone();
                                let target_label = label.clone();
                                let path_for_emit = path_str.clone();
                                std::thread::spawn(move || {
                                    for delay_ms in [500, 1500, 3000] {
                                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                                        let _ = handle.emit_to(&target_label, "open-file", &path_for_emit);
                                    }
                                });
                                continue; // skip the old broadcast path
                            }
                            Err(e) => {
                                eprintln!("[file-assoc] Failed to create new window: {}", e);
                                // Fall through to old behavior
                            }
                        }
                    }

                    // Cold start / iOS / fallback: load into the main window
                    // Store in pending state so frontend can retrieve it
                    if let Some(state) = _app_handle.try_state::<PendingFile>() {
                        *state.0.lock().unwrap() = Some(path_str.clone());
                    }

                    // Emit to the main window only (not all windows)
                    let _ = _app_handle.emit_to("main", "open-file", &path_str);

                    // Re-emit after delays to handle cold-start timing
                    // The WebView may not have loaded JS listeners yet
                    let handle = _app_handle.clone();
                    let path_for_retry = path_str.clone();
                    std::thread::spawn(move || {
                        for delay_ms in [500, 1500, 3000] {
                            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                            eprintln!("[file-assoc] re-emit open-file after {}ms", delay_ms);
                            let _ = handle.emit_to("main", "open-file", &path_for_retry);
                        }
                    });
                }
            }
        }
    });
}
