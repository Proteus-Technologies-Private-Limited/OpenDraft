use tauri::Manager;

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

// ── Sidecar (desktop only) ──────────────────────────────────────────────────
// On desktop (macOS / Windows / Linux) we spawn a Python backend sidecar.
// On mobile (iOS / Android) the frontend uses local SQLite instead, so
// there is no sidecar to start.

#[cfg(not(target_os = "ios"))]
#[cfg(not(target_os = "android"))]
mod desktop {
    use std::net::TcpStream;
    use std::path::PathBuf;
    use std::process::Child;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    pub const BACKEND_PORT: u16 = 18321;

    /// Result of waiting for the backend.
    pub enum BackendStatus {
        Ready,
        ProcessCrashed { exit_code: Option<i32>, stderr: String },
        Timeout,
    }

    /// Wait for the backend to accept TCP connections.
    /// Checks if the process has crashed during the wait.
    pub fn wait_for_backend(child: &mut Child, port: u16, timeout_secs: u64) -> BackendStatus {
        let start = Instant::now();
        while start.elapsed().as_secs() < timeout_secs {
            // Check if the process exited (crashed)
            match child.try_wait() {
                Ok(Some(status)) => {
                    // Process has exited — read any stderr output
                    let stderr = if let Some(ref mut err) = child.stderr {
                        use std::io::Read;
                        let mut buf = String::new();
                        let _ = err.read_to_string(&mut buf);
                        buf
                    } else {
                        String::new()
                    };
                    return BackendStatus::ProcessCrashed {
                        exit_code: status.code(),
                        stderr,
                    };
                }
                Ok(None) => { /* still running, keep waiting */ }
                Err(_) => { /* can't check status, keep waiting */ }
            }
            if TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
                return BackendStatus::Ready;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        BackendStatus::Timeout
    }

    /// Resolve the sidecar binary path.
    /// macOS/Linux: single file via externalBin (next to the main executable).
    /// Windows: onedir folder via resources (sidecar/ subdirectory).
    pub fn sidecar_path() -> Option<PathBuf> {
        let exe = std::env::current_exe().ok()?;
        let dir = exe.parent()?;
        let candidates = [
            // Windows onedir: sidecar/ directory next to exe
            dir.join("sidecar").join("opendraft-api.exe"),
            dir.join("sidecar").join("opendraft-api"),
            // macOS/Linux onefile: single binary next to exe (externalBin)
            dir.join("opendraft-api"),
            dir.join("opendraft-api.exe"),
        ];
        candidates.into_iter().find(|p| p.exists())
    }

    /// Holds the sidecar child process so it can be killed on exit.
    pub struct BackendProcess(pub Mutex<Option<Child>>);
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
        ])
        .setup(|app| {
            // Determine user data directory for storage
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");
            std::fs::create_dir_all(&app_data_dir).ok();

            // ── Desktop: spawn the Python backend sidecar ──────────
            #[cfg(not(target_os = "ios"))]
            #[cfg(not(target_os = "android"))]
            {
                let data_dir_str = app_data_dir.to_string_lossy().to_string();

                // Spawn sidecar — capture stderr for diagnostics
                let spawn_result = if let Some(bin) = desktop::sidecar_path() {
                    eprintln!("Sidecar binary found: {:?}", bin);
                    match std::process::Command::new(&bin)
                        .args([
                            "--port",
                            &desktop::BACKEND_PORT.to_string(),
                            "--data-dir",
                            &data_dir_str,
                        ])
                        .env("OPENDRAFT_DATA_DIR", &data_dir_str)
                        .stderr(std::process::Stdio::piped())
                        .spawn()
                    {
                        Ok(child) => {
                            eprintln!("Sidecar started: PID {}", child.id());
                            eprintln!("Data dir: {}", data_dir_str);
                            Ok(child)
                        }
                        Err(e) => {
                            eprintln!("Failed to spawn sidecar {:?}: {}", bin, e);
                            Err(format!("Could not start the backend process.\n\n\
                                Error: {}\n\n\
                                On Windows, your antivirus or SmartScreen may have\n\
                                blocked it. Please allow OpenDraft through your\n\
                                security settings and restart the application.", e))
                        }
                    }
                } else {
                    eprintln!("Sidecar binary not found (dev mode?)");
                    Err("The backend server binary was not found.\n\n\
                         The installation may be incomplete. Please reinstall OpenDraft.".to_string())
                };

                // Splash → main window transition
                let splash = app.get_webview_window("splashscreen");
                let main_window = app.get_webview_window("main");
                let app_handle = app.handle().clone();

                std::thread::spawn(move || {
                    let error_msg = match spawn_result {
                        Ok(mut child) => {
                            match desktop::wait_for_backend(&mut child, desktop::BACKEND_PORT, 30) {
                                desktop::BackendStatus::Ready => {
                                    eprintln!("Backend is ready on port {}", desktop::BACKEND_PORT);
                                    app_handle.manage(desktop::BackendProcess(
                                        std::sync::Mutex::new(Some(child)),
                                    ));
                                    None
                                }
                                desktop::BackendStatus::ProcessCrashed { exit_code, stderr } => {
                                    let code_str = exit_code
                                        .map(|c| c.to_string())
                                        .unwrap_or_else(|| "unknown".to_string());
                                    eprintln!("Sidecar crashed with exit code {}", code_str);
                                    if !stderr.is_empty() {
                                        eprintln!("Sidecar stderr:\n{}", stderr);
                                    }
                                    let detail = if !stderr.is_empty() {
                                        // Show last few lines of stderr for context
                                        let last_lines: String = stderr
                                            .lines()
                                            .rev()
                                            .take(5)
                                            .collect::<Vec<_>>()
                                            .into_iter()
                                            .rev()
                                            .collect::<Vec<_>>()
                                            .join("\n");
                                        format!(
                                            "The backend server crashed on startup (exit code {}).\n\n\
                                             Error details:\n{}\n\n\
                                             This is often caused by:\n\
                                             • Antivirus software blocking the server\n\
                                             • A missing Visual C++ Redistributable\n\
                                             • Port {} already in use by another application\n\n\
                                             Try adding OpenDraft to your antivirus exceptions\n\
                                             and restart the application.",
                                            code_str, last_lines, desktop::BACKEND_PORT
                                        )
                                    } else {
                                        format!(
                                            "The backend server crashed on startup (exit code {}).\n\n\
                                             This is often caused by:\n\
                                             • Antivirus software blocking the server\n\
                                             • A missing Visual C++ Redistributable\n\
                                             • Port {} already in use by another application\n\n\
                                             Try adding OpenDraft to your antivirus exceptions\n\
                                             and restart the application.",
                                            code_str, desktop::BACKEND_PORT
                                        )
                                    };
                                    Some(detail)
                                }
                                desktop::BackendStatus::Timeout => {
                                    // Process is still running but not listening — likely blocked
                                    app_handle.manage(desktop::BackendProcess(
                                        std::sync::Mutex::new(Some(child)),
                                    ));
                                    Some(format!(
                                        "The backend server started but is not responding on port {}.\n\n\
                                         This is often caused by:\n\
                                         • Windows Firewall blocking localhost connections\n\
                                         • Antivirus software intercepting the connection\n\
                                         • Another application using port {}\n\n\
                                         Try these steps:\n\
                                         1. Add OpenDraft to your antivirus exceptions\n\
                                         2. Allow OpenDraft through Windows Firewall\n\
                                         3. Restart the application",
                                        desktop::BACKEND_PORT, desktop::BACKEND_PORT
                                    ))
                                }
                            }
                        }
                        Err(msg) => Some(msg),
                    };

                    std::thread::sleep(std::time::Duration::from_millis(500));

                    if let Some(main) = main_window {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                    if let Some(sp) = splash {
                        let _ = sp.close();
                    }

                    if let Some(msg) = error_msg {
                        use tauri_plugin_dialog::DialogExt;
                        app_handle.dialog()
                            .message(msg)
                            .title("OpenDraft — Backend Error")
                            .show(|_| {});
                    }
                });
            }

            // ── Mobile: no sidecar needed — frontend uses SQLite ───
            #[cfg(any(target_os = "ios", target_os = "android"))]
            {
                eprintln!("Mobile mode — using local SQLite storage");
                eprintln!("Data dir: {}", app_data_dir.display());
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

    app.run(|app, event| {
            // ── Desktop: kill sidecar on exit ──────────────────────
            #[cfg(not(target_os = "ios"))]
            #[cfg(not(target_os = "android"))]
            {
                if let tauri::RunEvent::Exit = event {
                    if let Some(state) = app.try_state::<desktop::BackendProcess>() {
                        if let Ok(mut guard) = state.0.lock() {
                            if let Some(mut child) = guard.take() {
                                let _ = child.kill();
                                let _ = child.wait();
                            }
                        }
                    }
                }
            }

            // Suppress unused-variable warnings on mobile
            #[cfg(any(target_os = "ios", target_os = "android"))]
            {
                let _ = app;
                let _ = event;
            }
        });
}
