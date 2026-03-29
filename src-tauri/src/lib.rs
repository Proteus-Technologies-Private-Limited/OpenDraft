use tauri::Manager;

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

    /// Wait for the backend to accept TCP connections.
    pub fn wait_for_backend(port: u16, timeout_secs: u64) -> bool {
        let start = Instant::now();
        while start.elapsed().as_secs() < timeout_secs {
            if TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        false
    }

    /// Resolve the sidecar binary path.
    pub fn sidecar_path() -> Option<PathBuf> {
        let exe = std::env::current_exe().ok()?;
        let dir = exe.parent()?;
        let candidates = [
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

                if let Some(bin) = desktop::sidecar_path() {
                    match std::process::Command::new(&bin)
                        .args([
                            "--port",
                            &desktop::BACKEND_PORT.to_string(),
                            "--data-dir",
                            &data_dir_str,
                        ])
                        .env("OPENDRAFT_DATA_DIR", &data_dir_str)
                        .spawn()
                    {
                        Ok(child) => {
                            eprintln!("Sidecar started: {:?} (PID {})", bin, child.id());
                            eprintln!("Data dir: {}", data_dir_str);
                            app.manage(desktop::BackendProcess(
                                std::sync::Mutex::new(Some(child)),
                            ));
                        }
                        Err(e) => {
                            eprintln!("Failed to spawn sidecar {:?}: {}", bin, e);
                        }
                    }
                } else {
                    eprintln!("Sidecar binary not found (dev mode?)");
                }

                // Splash → main window transition
                let splash = app.get_webview_window("splashscreen");
                let main_window = app.get_webview_window("main");

                std::thread::spawn(move || {
                    desktop::wait_for_backend(desktop::BACKEND_PORT, 30);
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
