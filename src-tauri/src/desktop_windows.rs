//! Desktop window persistence and native integration for issue #281, Part 1.
//! The official plugin owns size/maximized/full-screen state. The companion
//! file records normal bounds plus display identity/work area for safe placement.
use crate::window_placement::{self as policy, Display, Placement, Rect};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf, sync::Mutex};
use tauri::{Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_window_state::{StateFlags, WindowExt};

const FILE_NAME: &str = "window-displays.json";

pub fn state_flags() -> StateFlags {
    // Visibility belongs to the splash transition. Decorations belong to the
    // platform. Position is handled here, and is never requested on Wayland.
    StateFlags::SIZE | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
}

// The startup window has persistent state. Secondary windows are created by
// an explicit action; group their plugin cache so stale counter labels cannot
// restore full-screen state before we place them on the caller's display.
pub fn state_label(label: &str) -> &str {
    if label != "main" && tracked(label) {
        "secondary"
    } else {
        label
    }
}

pub fn tracked(label: &str) -> bool {
    label == "main"
        || label
            .strip_prefix("main-")
            .is_some_and(|n| !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit()))
}

#[derive(Clone, Serialize, Deserialize)]
struct SavedPlacement {
    position: [i32; 2],
    outer_size: [u32; 2],
    inner_size: [u32; 2],
    display_name: Option<String>,
    work_position: [i32; 2],
    work_size: [u32; 2],
    scale: f64,
}

impl From<Placement> for SavedPlacement {
    fn from(p: Placement) -> Self {
        Self {
            position: [p.outer.x, p.outer.y],
            outer_size: [p.outer.width, p.outer.height],
            inner_size: [p.inner.0, p.inner.1],
            display_name: p.display.name,
            work_position: [p.display.area.x, p.display.area.y],
            work_size: [p.display.area.width, p.display.area.height],
            scale: p.display.scale,
        }
    }
}

impl SavedPlacement {
    fn placement(&self) -> Option<Placement> {
        let p = Placement {
            outer: Rect {
                x: self.position[0],
                y: self.position[1],
                width: self.outer_size[0],
                height: self.outer_size[1],
            },
            inner: (self.inner_size[0], self.inner_size[1]),
            display: Display {
                name: self.display_name.clone(),
                area: Rect {
                    x: self.work_position[0],
                    y: self.work_position[1],
                    width: self.work_size[0],
                    height: self.work_size[1],
                },
                scale: self.scale,
            },
        };
        p.valid().then_some(p)
    }
}

struct WindowDisplays {
    path: Option<PathBuf>,
    windows: Mutex<HashMap<String, SavedPlacement>>,
    last_focused: Mutex<Option<String>>,
}

fn display(monitor: &tauri::Monitor) -> Display {
    let area = monitor.work_area();
    Display {
        name: monitor.name().cloned(),
        area: Rect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        },
        scale: monitor.scale_factor(),
    }
}

fn can_position(window: &tauri::Window) -> bool {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        // Inspect the actual GTK backend: WAYLAND_DISPLAY may also be set when
        // this app is using X11/XWayland. All callers run on the UI thread.
        window
            .gtk_window()
            .is_ok_and(|w| w.display().type_().name() != "GdkWaylandDisplay")
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
        true
    }
}

fn snapshot(window: &tauri::Window) -> Option<Placement> {
    if window.is_minimized().ok()? || window.is_maximized().ok()? || window.is_fullscreen().ok()? {
        return None;
    }
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())?;
    let inner = window.inner_size().ok()?;
    let outer = window.outer_size().ok()?;
    let pos = if can_position(window) {
        window.outer_position().ok()?
    } else {
        PhysicalPosition::new(0, 0)
    };
    let p = Placement {
        outer: Rect {
            x: pos.x,
            y: pos.y,
            width: outer.width,
            height: outer.height,
        },
        inner: (inner.width, inner.height),
        display: display(&monitor),
    };
    p.valid().then_some(p)
}

fn remember(window: &tauri::Window) {
    if !tracked(window.label()) {
        return;
    }
    // Initial frame setters can emit intermediate geometry while still hidden.
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    if let Some(p) = snapshot(window) {
        record(window, p);
    }
}

fn record(window: &tauri::Window, p: Placement) {
    if let Some(state) = window.app_handle().try_state::<WindowDisplays>() {
        if let Ok(mut windows) = state.windows.lock() {
            windows.insert(window.label().into(), p.into());
        }
    }
}

fn persist(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<WindowDisplays>() else {
        return;
    };
    let Some(path) = &state.path else {
        return;
    };
    // Serialize writes, including the temporary file, across close/exit events.
    let Ok(windows) = state.windows.lock() else {
        return;
    };
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        std::fs::create_dir_all(path.parent().ok_or("no config directory")?)?;
        let temporary = path.with_extension("json.tmp");
        std::fs::write(&temporary, serde_json::to_vec_pretty(&*windows)?)?;
        std::fs::rename(temporary, path)?;
        Ok(())
    })();
    if let Err(error) = result {
        eprintln!("[window] Could not save display placement: {error}");
    }
}

fn apply(window: &tauri::Window, p: &Placement) -> tauri::Result<()> {
    let scale = p.display.scale;
    window.set_min_size(Some(tauri::LogicalSize::new(
        800.0_f64.min(p.inner.0 as f64 / scale),
        600.0_f64.min(p.inner.1 as f64 / scale),
    )))?;
    let position = PhysicalPosition::new(p.outer.x, p.outer.y);
    let size = PhysicalSize::new(p.inner.0, p.inner.1);
    // Cocoa converts physical values using the current window's scale. Use
    // the destination scale explicitly before crossing displays.
    #[cfg(target_os = "macos")]
    let (position, size) = (
        position.to_logical::<f64>(scale),
        size.to_logical::<f64>(scale),
    );
    let positioned = can_position(window);
    if positioned {
        window.set_position(position)?;
    }
    window.set_size(size)?;
    if positioned {
        window.set_position(position)?;
    }
    record(window, p.clone());
    Ok(())
}

fn fit_saved(window: &tauri::Window, saved: &Placement) -> tauri::Result<()> {
    let displays: Vec<_> = window
        .available_monitors()?
        .iter()
        .map(display)
        .filter(Display::valid)
        .collect();
    let primary = window
        .primary_monitor()?
        .map(|m| display(&m))
        .or_else(|| displays.first().cloned());
    if let Some(p) = primary.and_then(|primary| policy::restore(saved, &displays, &primary)) {
        apply(window, &p)?;
    }
    Ok(())
}

pub fn setup(app: &tauri::AppHandle) {
    let path = app.path().app_config_dir().ok().map(|p| p.join(FILE_NAME));
    let windows = path
        .as_ref()
        .map(|path| {
            let load = || -> Result<HashMap<String, SavedPlacement>, Box<dyn std::error::Error>> {
                let file = std::fs::File::open(path)?;
                if file.metadata()?.len() > 1024 * 1024 {
                    return Err("placement file exceeds size limit".into());
                }
                Ok(serde_json::from_reader(std::io::BufReader::new(file))?)
            };
            match load() {
                Ok(windows) => windows,
                Err(error) => {
                    if error
                        .downcast_ref::<std::io::Error>()
                        .is_none_or(|e| e.kind() != std::io::ErrorKind::NotFound)
                    {
                        eprintln!("[window] Could not read display placement: {error}");
                    }
                    HashMap::new()
                }
            }
        })
        .unwrap_or_default();
    app.manage(WindowDisplays {
        path,
        windows: Mutex::new(windows),
        last_focused: Mutex::new(None),
    });
    if let Some(main) = app.get_webview_window("main") {
        let window = &main.as_ref().window();
        let saved = app
            .state::<WindowDisplays>()
            .windows
            .lock()
            .unwrap()
            .get("main")
            .and_then(SavedPlacement::placement);
        let result = (|| -> tauri::Result<()> {
            if let Some(saved) = saved {
                fit_saved(window, &saved)?;
            } else {
                if let Some(current) = snapshot(window) {
                    fit_saved(window, &current)?;
                }
            }
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("[window] Could not restore normal bounds: {error}");
        }
    }
}

/// Called on the UI thread after construction, before showing a new window.
pub fn show_new(window: &tauri::WebviewWindow, origin: Option<&tauri::WebviewWindow>) {
    let target = &window.as_ref().window();
    // Secondary windows skip automatic restoration and start normally. Only
    // startup restores maximized/full-screen state, after safe normal bounds.
    let result = (|| -> tauri::Result<()> {
        let origin_windows = origin.map(|w| w.as_ref().window());
        let origin = origin_windows.as_ref();
        let p = origin.and_then(|source| {
            let monitor = source.current_monitor().ok().flatten()?;
            let state = source.app_handle().try_state::<WindowDisplays>();
            let mut p = snapshot(source).or_else(|| {
                state
                    .as_ref()?
                    .windows
                    .lock()
                    .ok()?
                    .get(source.label())
                    .and_then(SavedPlacement::placement)
            })?;
            // Maximizing/full-screening can move a window to another display.
            // Rebase cached normal bounds at that display's current DPI first.
            let current = display(&monitor);
            p = policy::restore(&p, &[current.clone()], &current)?;
            policy::new_window(&p)
        });
        if let Some(p) = p {
            apply(target, &p)?;
        } else if let Some(p) = snapshot(target) {
            fit_saved(target, &p)?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        eprintln!("[window] Could not apply new-window placement: {error}");
    }
    show_after_placement(window);
}

fn show_and_focus(window: &tauri::WebviewWindow) {
    if let Err(error) = window.show() {
        eprintln!("[window] Could not show window: {error}");
    }
    if let Err(error) = window.set_focus() {
        eprintln!("[window] Could not focus window: {error}");
    }
}

fn show_after_placement(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        // Tao queues Cocoa frame changes on the main dispatch queue.
        let window = window.clone();
        dispatch2::DispatchQueue::main().exec_async(move || show_and_focus(&window));
    }
    #[cfg(not(target_os = "macos"))]
    show_and_focus(window);
}

pub fn show_startup(window: &tauri::WebviewWindow) {
    show_and_focus(window);
    if let Err(error) = window.restore_state(StateFlags::MAXIMIZED | StateFlags::FULLSCREEN) {
        eprintln!("[window] Could not restore window mode: {error}");
    }
}

pub fn file_open_origin(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let last = app
        .try_state::<WindowDisplays>()
        .and_then(|state| state.last_focused.lock().ok()?.clone());
    last.and_then(|label| app.get_webview_window(&label))
        .or_else(|| app.get_webview_window("main"))
        .or_else(|| {
            app.webview_windows()
                .into_values()
                .find(|window| tracked(window.label()))
        })
}

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if !tracked(window.label()) {
        return;
    }
    match event {
        tauri::WindowEvent::Focused(true) => {
            if let Some(state) = window.app_handle().try_state::<WindowDisplays>() {
                if let Ok(mut last) = state.last_focused.lock() {
                    *last = Some(window.label().into());
                }
            }
        }
        tauri::WindowEvent::Destroyed if window.label() != "main" => {
            if let Some(state) = window.app_handle().try_state::<WindowDisplays>() {
                if let Ok(mut windows) = state.windows.lock() {
                    windows.remove(window.label());
                }
            }
        }
        tauri::WindowEvent::Moved(_)
        | tauri::WindowEvent::Resized(_)
        | tauri::WindowEvent::ScaleFactorChanged { .. } => remember(window),
        tauri::WindowEvent::CloseRequested { .. } => {
            remember(window);
            persist(window.app_handle());
        }
        _ => {}
    }
}

pub fn on_exit(app: &tauri::AppHandle) {
    for window in app.webview_windows().values() {
        remember(&window.as_ref().window());
    }
    persist(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splash_and_unrelated_windows_are_never_tracked() {
        assert!(tracked("main"));
        assert!(tracked("main-12"));
        for label in ["splashscreen", "panel-main", "main-", "main-script"] {
            assert!(!tracked(label));
        }
        assert_eq!(state_label("main"), "main");
        assert_eq!(state_label("main-12"), "secondary");
        assert_eq!(state_label("splashscreen"), "splashscreen");
    }

    #[test]
    fn plugin_does_not_restore_visibility_decorations_or_wayland_positions() {
        let flags = state_flags();
        assert!(flags.contains(StateFlags::SIZE | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN));
        assert!(
            !flags.intersects(StateFlags::VISIBLE | StateFlags::DECORATIONS | StateFlags::POSITION)
        );
    }

    #[test]
    fn normal_bounds_and_named_display_survive_metadata_round_trip() {
        let p = Placement {
            outer: Rect {
                x: -1800,
                y: 40,
                width: 1008,
                height: 732,
            },
            inner: (1000, 700),
            display: Display {
                name: Some("external".into()),
                area: Rect {
                    x: -1920,
                    y: 0,
                    width: 1920,
                    height: 1040,
                },
                scale: 1.0,
            },
        };
        let json = serde_json::to_vec(&SavedPlacement::from(p.clone())).unwrap();
        let saved: SavedPlacement = serde_json::from_slice(&json).unwrap();
        assert_eq!(saved.placement(), Some(p));
        let mut bad = saved;
        bad.scale = 0.0;
        assert!(bad.placement().is_none());
    }
}
