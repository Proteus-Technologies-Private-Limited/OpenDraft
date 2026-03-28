use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;

const BACKEND_PORT: u16 = 18321;

/// Wait for the backend to accept TCP connections.
fn wait_for_backend(port: u16, timeout_secs: u64) -> bool {
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
/// In a bundled .app on macOS the layout is:
///   OpenDraft.app/Contents/MacOS/OpenDraft       (main binary)
///   OpenDraft.app/Contents/MacOS/opendraft-api   (sidecar)
fn sidecar_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;

    // Try the exact name first (macOS/Linux), then with .exe (Windows)
    let candidates = [
        dir.join("opendraft-api"),
        dir.join("opendraft-api.exe"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

/// Holds the sidecar child process so it can be killed on exit.
struct BackendProcess(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Determine user data directory for project storage
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");
            std::fs::create_dir_all(&app_data_dir).ok();

            let data_dir_str = app_data_dir.to_string_lossy().to_string();

            // Spawn the backend sidecar using std::process::Command
            // (bypasses shell-plugin scope restrictions on args/env)
            if let Some(bin) = sidecar_path() {
                match Command::new(&bin)
                    .args(["--port", &BACKEND_PORT.to_string(), "--data-dir", &data_dir_str])
                    .env("OPENDRAFT_DATA_DIR", &data_dir_str)
                    .spawn()
                {
                    Ok(child) => {
                        eprintln!("Sidecar started: {:?} (PID {})", bin, child.id());
                        eprintln!("Data dir: {}", data_dir_str);
                        app.manage(BackendProcess(Mutex::new(Some(child))));
                    }
                    Err(e) => {
                        eprintln!("Failed to spawn sidecar {:?}: {}", bin, e);
                    }
                }
            } else {
                eprintln!("Sidecar binary not found (dev mode?)");
            }

            // Grab window handles for the splash-to-main transition
            let splash = app.get_webview_window("splashscreen");
            let main_window = app.get_webview_window("main");

            // Wait for backend in a background thread so the splash renders immediately
            std::thread::spawn(move || {
                wait_for_backend(BACKEND_PORT, 30);

                // Small extra pause so the main webview finishes its initial render
                std::thread::sleep(Duration::from_millis(500));

                if let Some(main) = main_window {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
                if let Some(sp) = splash {
                    let _ = sp.close();
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Kill the backend sidecar on exit
                if let Some(state) = app.try_state::<BackendProcess>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
