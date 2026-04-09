use std::sync::Mutex;
use percent_encoding::percent_decode_str;
use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri::menu::{Menu, Submenu, PredefinedMenuItem};

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

#[cfg(target_os = "android")]
fn android_read_content_uri(uri_str: &str) -> Result<ContentUriResult, String> {
    use jni::objects::{JObject, JString, JValue};
    use jni::JavaVM;

    let ctx = ndk_context::android_context();
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
    let filename = android_query_display_name(&mut env, &resolver, &uri_obj)
        .unwrap_or_else(|| extract_filename_from_uri(uri_str));

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

/// Read the data URI from the Android Activity's launching intent.
/// Called during setup to detect file-association cold starts on Android.
#[cfg(target_os = "android")]
fn android_get_intent_data() -> Option<String> {
    use jni::objects::JObject;
    use jni::JavaVM;

    let ctx = ndk_context::android_context();
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

// ── iOS file helpers (Objective-C FFI) ────────────────────────────────────
// On iOS, files from the Files app or document picker require security-scoped
// URL access. These functions are defined in FileHelpers.m and linked into
// the iOS binary automatically via XcodeGen.

#[cfg(target_os = "ios")]
extern "C" {
    fn ios_present_share_sheet(file_path: *const std::ffi::c_char);
    fn ios_read_text_file(path: *const std::ffi::c_char) -> *mut std::ffi::c_char;
    fn ios_free_string(ptr: *mut std::ffi::c_char);
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
const OPENABLE_EXTENSIONS: &[&str] = &["fdx", "fountain", "odraft", "txt"];

fn is_openable_file(path: &str) -> bool {
    let ext = path.rsplit('.').next().unwrap_or("");
    OPENABLE_EXTENSIONS.contains(&ext.to_lowercase().as_str())
}

#[tauri::command]
fn get_opened_file(state: tauri::State<PendingFile>) -> Option<String> {
    state.0.lock().unwrap().clone()
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
    std::fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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

            match std::fs::read(file_path) {
                Ok(data) => {
                    let mime = guess_mime(file_path);
                    tauri::http::Response::builder()
                        .status(200)
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(data)
                        .unwrap()
                }
                Err(e) => {
                    eprintln!("[asset] Failed to read {}: {}", file_path_str, e);
                    tauri::http::Response::builder()
                        .status(404)
                        .body(Vec::new())
                        .unwrap()
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            save_text_to_path,
            save_binary_to_path,
            read_text_file,
            read_binary_file,
            http_fetch,
            fetch_link_preview,
            get_opened_file,
            read_content_uri,
            ios_save_and_share,
            ios_save_and_share_binary,
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

            // Android: check the launching intent for a data URI
            #[cfg(target_os = "android")]
            if pending.is_none() {
                if let Some(uri) = android_get_intent_data() {
                    pending = Some(uri);
                }
            }

            // Clone before moving into managed state (needed for Android re-emit)
            #[cfg(target_os = "android")]
            let android_pending = pending.clone();

            app.manage(PendingFile(Mutex::new(pending)));

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
                            let _ = handle.emit("open-file", &uri);
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
                });
            }

            Ok(())
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

                    // On iOS, copy the file to the app's temp directory while we
                    // still have security-scoped access from the OS callback.
                    // With LSSupportsOpeningDocumentsInPlace=false, iOS usually
                    // copies files to Documents/Inbox first, but as a safety net
                    // we also copy to temp in case the original is outside the sandbox.
                    #[cfg(target_os = "ios")]
                    {
                        let temp_dir = std::env::temp_dir();
                        let fname = path.file_name().unwrap_or_default();
                        let temp_path = temp_dir.join(fname);
                        match std::fs::copy(&path, &temp_path) {
                            Ok(_) => {
                                eprintln!("[file-assoc] iOS: copied to sandbox temp: {}", temp_path.display());
                                path_str = temp_path.to_string_lossy().to_string();
                            }
                            Err(e) => {
                                eprintln!("[file-assoc] iOS: copy to temp failed ({}), using original", e);
                            }
                        }
                    }

                    eprintln!("[file-assoc] RunEvent::Opened: {}", path_str);

                    // Store in pending state so frontend can retrieve it
                    if let Some(state) = _app_handle.try_state::<PendingFile>() {
                        *state.0.lock().unwrap() = Some(path_str.clone());
                    }

                    // Emit immediately (may be lost if WebView not ready)
                    let _ = _app_handle.emit("open-file", &path_str);

                    // Re-emit after delays to handle cold-start timing
                    // The WebView may not have loaded JS listeners yet
                    let handle = _app_handle.clone();
                    let path_for_retry = path_str.clone();
                    std::thread::spawn(move || {
                        for delay_ms in [500, 1500, 3000] {
                            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                            eprintln!("[file-assoc] re-emit open-file after {}ms", delay_ms);
                            let _ = handle.emit("open-file", &path_for_retry);
                        }
                    });
                }
            }
        }
    });
}
