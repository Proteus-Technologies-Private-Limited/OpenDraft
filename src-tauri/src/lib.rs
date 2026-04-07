use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, Submenu, PredefinedMenuItem};

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
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
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
        .invoke_handler(tauri::generate_handler![
            save_text_to_path,
            save_binary_to_path,
            read_text_file,
            read_binary_file,
            http_fetch,
            fetch_link_preview,
            get_opened_file,
        ])
        // ── Minimal native menu ──────────────────────────────────────────
        // macOS: keep only App menu (About/Hide/Quit) + Window menu
        //        (Minimize/Maximize/Close) so Cmd+Q/H/M keep working.
        // Windows/Linux: empty menu — no native menu bar shown.
        .menu(|app_handle| {
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
                Menu::with_items(app_handle, &[&app_submenu, &window_submenu])
            }
            #[cfg(not(target_os = "macos"))]
            {
                Menu::new(app_handle)
            }
        })
        .setup(|app| {
            // Ensure user data directory exists
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");
            std::fs::create_dir_all(&app_data_dir).ok();

            eprintln!("OpenDraft starting — local SQLite storage");
            eprintln!("Data dir: {}", app_data_dir.display());

            // ── Check CLI args for file association launch (Windows/Linux) ──
            let mut pending: Option<String> = None;
            let args: Vec<String> = std::env::args().collect();
            if args.len() > 1 {
                let path = &args[1];
                if is_openable_file(path) && std::path::Path::new(path).is_file() {
                    eprintln!("File association launch: {}", path);
                    pending = Some(path.clone());
                }
            }
            app.manage(PendingFile(Mutex::new(pending)));

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
        // ── Handle file association open events (macOS only) ──────
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path_str = path.to_string_lossy().to_string();
                    if !is_openable_file(&path_str) {
                        continue;
                    }
                    eprintln!("RunEvent::Opened file: {}", path_str);

                    // Emit to frontend (works if window is already loaded)
                    if let Some(window) = _app_handle.get_webview_window("main") {
                        let _ = window.emit("open-file", &path_str);
                    }

                    // Also store in pending state (for startup timing edge case)
                    if let Some(state) = _app_handle.try_state::<PendingFile>() {
                        *state.0.lock().unwrap() = Some(path_str);
                    }
                }
            }
        }
    });
}
