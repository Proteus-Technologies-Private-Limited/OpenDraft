//! Native broker: callers identify themselves through Tauri injection, never
//! through a supplied owner label. Panels receive summaries, not editor objects.
#[cfg(desktop)]
use crate::panel_ownership::{navigator_label, Panel, Panels};
#[cfg(desktop)]
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Mutex,
};
#[cfg(desktop)]
static PANEL_COUNTER: AtomicU32 = AtomicU32::new(1);
#[cfg(desktop)]
use tauri::{Emitter, Manager};

#[cfg(desktop)]
#[derive(Default)]
pub struct Registry(Mutex<Panels>);

#[tauri::command]
pub async fn open_panel_window(
    window: tauri::WebviewWindow,
    session: String,
) -> Result<String, String> {
    #[cfg(desktop)]
    {
        if session.is_empty() || session.len() > 100 {
            return Err("Invalid panel session".into());
        }
        let base = navigator_label(window.label()).ok_or("Only editors can open panels")?;
        let app = window.app_handle().clone();
        let registry = app.state::<Registry>();
        let (label, previous) = {
            let mut panels = registry.0.lock().unwrap();
            if let Some(label) = panels.targets(window.label(), &session).first().cloned() {
                drop(panels);
                if let Some(existing) = app.get_webview_window(&label) {
                    let _ = existing.unminimize();
                    let _ = existing.show();
                    let _ = existing.set_focus();
                    return Ok(label);
                }
                return Err("The panel is still opening".into());
            }
            let previous = panels.take_owned(window.label(), None);
            // Reserve before construction. Old destruction events have unique
            // labels, and reload/close revokes even an in-flight reservation.
            let label = format!("{base}-{}", PANEL_COUNTER.fetch_add(1, Ordering::Relaxed));
            panels.0.insert(
                label.clone(),
                Panel {
                    owner: window.label().into(),
                    session,
                },
            );
            (label, previous)
        };
        destroy_panels(&app, previous);
        let result = tauri::WebviewWindowBuilder::new(
            &app,
            &label,
            tauri::WebviewUrl::App("/".into()),
        )
        .title("OpenDraft")
        .inner_size(440.0, 720.0)
        .min_inner_size(260.0, 240.0)
        .visible(false)
        .focused(false)
        .resizable(true)
        .build();
        let panel = match result {
            Ok(panel) => panel,
            Err(error) => {
                registry.0.lock().unwrap().0.remove(&label);
                return Err(error.to_string());
            }
        };
        if !registry.0.lock().unwrap().0.contains_key(&label)
            || app.get_webview_window(window.label()).is_none()
        {
            let _ = panel.destroy();
            return Err("The owner closed while opening the panel".into());
        }
        let target = panel.clone();
        if let Err(error) = panel.run_on_main_thread(move || {
            #[cfg(not(target_os = "macos"))]
            let _ = target.remove_menu();
            #[cfg(target_os = "linux")]
            crate::prepare_linux_titlebar(&target);
            crate::desktop_windows::show_panel(&target, &window);
        }) {
            registry.0.lock().unwrap().0.remove(&label);
            let _ = panel.destroy();
            return Err(error.to_string());
        }
        Ok(label)
    }
    #[cfg(not(desktop))]
    {
        let _ = (window, session);
        Err("Panel windows require the desktop app".into())
    }
}

#[tauri::command]
pub fn panel_context(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    #[cfg(desktop)]
    {
        let state = window.app_handle().state::<Registry>();
        let guard = state.0.lock().unwrap();
        let panel = guard
            .0
            .get(window.label())
            .ok_or("This is not a panel window")?;
        Ok(serde_json::json!({ "owner": panel.owner, "session": panel.session }))
    }
    #[cfg(not(desktop))]
    {
        let _ = window;
        Err("Panel windows require the desktop app".into())
    }
}

#[tauri::command]
pub fn publish_panel_snapshot(
    window: tauri::WebviewWindow,
    session: String,
    snapshot: serde_json::Value,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if !crate::panel_ownership::editor_label(window.label())
            || snapshot.to_string().len() > 4 * 1024 * 1024
        {
            return Err("Invalid panel snapshot".into());
        }
        let app = window.app_handle();
        let labels = app
            .state::<Registry>()
            .0
            .lock()
            .unwrap()
            .targets(window.label(), &session);
        for label in labels {
            if let Some(target) = app.get_webview_window(&label) {
                let theme = match snapshot.get("appearance").and_then(|v| v.as_str()) {
                    Some("light") => Some(tauri::Theme::Light),
                    Some("dark" | "dark-pages") => Some(tauri::Theme::Dark),
                    _ => None,
                };
                if let Some(theme) = theme {
                    if target.theme().ok().as_ref() != Some(&theme) {
                        let _ = target.set_theme(Some(theme));
                    }
                }
            }
            app.emit_to(&label, "panel-snapshot", &snapshot)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = (window, session, snapshot);
        Err("Panel windows require the desktop app".into())
    }
}

#[tauri::command]
pub fn panel_command(
    window: tauri::WebviewWindow,
    action: serde_json::Value,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if !matches!(
            action.get("kind").and_then(|v| v.as_str()),
            Some("ready" | "navigate" | "return")
        ) || action.to_string().len() > 1024
        {
            return Err("Invalid panel command".into());
        }
        let app = window.app_handle();
        let panel = app
            .state::<Registry>()
            .0
            .lock()
            .unwrap()
            .0
            .get(window.label())
            .cloned()
            .ok_or("This panel has closed")?;
        if action.get("kind").and_then(|v| v.as_str()) == Some("return") {
            crate::desktop_windows::remember_panel(&window);
            window.destroy().map_err(|e| e.to_string())?;
            if let Some(owner) = app.get_webview_window(&panel.owner) {
                let _ = owner.unminimize();
                let _ = owner.show();
                let _ = owner.set_focus();
            }
        } else {
            app.emit_to(
                &panel.owner,
                "panel-command",
                serde_json::json!({ "session": panel.session, "action": action }),
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = (window, action);
        Err("Panel windows require the desktop app".into())
    }
}

#[tauri::command]
pub fn close_panel_windows(window: tauri::WebviewWindow, session: String) {
    #[cfg(desktop)]
    {
        let app = window.app_handle();
        let panels = app
            .state::<Registry>()
            .0
            .lock()
            .unwrap()
            .take_owned(window.label(), Some(&session));
        destroy_panels(app, panels);
    }
    #[cfg(not(desktop))]
    let _ = (window, session);
}

#[cfg(desktop)]
pub fn close_owned(app: &tauri::AppHandle, owner: &str) {
    let Some(registry) = app.try_state::<Registry>() else {
        return;
    };
    let panels = registry.0.lock().unwrap().take_owned(owner, None);
    destroy_panels(app, panels);
}

#[cfg(desktop)]
fn destroy_panels(app: &tauri::AppHandle, panels: Vec<(String, Panel)>) {
    for (label, panel) in panels {
        if let Some(window) = app.get_webview_window(&label) {
            crate::desktop_windows::remember_panel(&window);
            let _ = window.destroy();
        }
        let _ = app.emit_to(
            &panel.owner,
            "panel-closed",
            serde_json::json!({ "session": panel.session }),
        );
    }
}

#[cfg(desktop)]
pub fn destroyed(app: &tauri::AppHandle, label: &str) {
    close_owned(app, label);
    if let Some(state) = app.try_state::<Registry>() {
        let panel = state.0.lock().unwrap().0.remove(label);
        if let Some(panel) = panel {
            let _ = app.emit_to(
                &panel.owner,
                "panel-closed",
                serde_json::json!({ "session": panel.session }),
            );
        }
    }
}
