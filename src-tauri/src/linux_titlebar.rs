//! GTK input routing for Tao 0.35.3's Wayland client-side title bar (#271).
//! Checked against `tao-0.35.3/src/platform_impl/linux/wayland/header.rs`,
//! `WlHeader::setup`: `event_box.set_above_child(true)`. Revisit on a Tao bump.
use gtk::prelude::*;

/// Keep the wrapper below its header's input windows, so native buttons receive
/// the first click. Tao sets `above-child` to true, which intercepts the clicks
/// before they reach minimize/maximize/close. GTK still handles title-bar drag,
/// double-click and resize normally. Leave other decorations untouched (X11
/// usually has no client-side title bar).
///
/// Must run on GTK's main thread, after the native title bar has been created.
pub fn enable_header_buttons(window: &impl IsA<gtk::Window>) {
    let Some(wrapper) = window
        .titlebar()
        .and_then(|widget| widget.downcast::<gtk::EventBox>().ok())
    else {
        return;
    };
    if wrapper
        .child()
        .is_some_and(|child| child.is::<gtk::HeaderBar>())
    {
        wrapper.set_above_child(false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::tao::{
        event_loop::EventLoopBuilder,
        platform::unix::{EventLoopBuilderExtUnix, WindowExtUnix},
        window::WindowBuilder,
    };

    // Explicit display tests: a normal headless `cargo test --lib` skips them.
    // Run separately so each Tao event loop owns its process's GTK thread.
    #[test]
    #[ignore = "requires a Wayland compositor; test.yml runs this explicitly"]
    fn real_tao_wayland_titlebars() {
        let event_loop = EventLoopBuilder::<()>::new().with_any_thread(true).build();
        // Both startup and later windows must work with no webview/page load.
        for title in ["Initial window", "New window"] {
            let window = WindowBuilder::new()
                .with_title(title)
                .with_visible(false)
                .build(&event_loop)
                .expect("create real Tao window");
            let native = window.gtk_window();
            assert_eq!(native.display().type_().name(), "GdkWaylandDisplay");
            let wrapper = native
                .titlebar()
                .expect("Tao Wayland title bar")
                .downcast::<gtk::EventBox>()
                .expect("Tao changed the title-bar wrapper; revisit workaround");
            let header = wrapper
                .child()
                .expect("Tao header child")
                .downcast::<gtk::HeaderBar>()
                .expect("Tao changed the header; revisit workaround");
            enable_header_buttons(native);
            assert!(
                !wrapper.is_above_child(),
                "native buttons must receive input"
            );
            assert!(header.shows_close_button());
            enable_header_buttons(native);
            assert!(!wrapper.is_above_child(), "repeated setup is safe");
            assert_eq!(native.titlebar(), Some(wrapper.upcast()));
        }

        // A custom decoration without Tao's structure must stay untouched.
        let custom = gtk::Window::new(gtk::WindowType::Toplevel);
        let wrapper = gtk::EventBox::new();
        wrapper.set_above_child(true);
        wrapper.add(&gtk::Label::new(Some("Other decoration")));
        custom.set_titlebar(Some(&wrapper));
        enable_header_buttons(&custom);
        assert!(wrapper.is_above_child());
        custom.close();
    }

    #[test]
    #[ignore = "requires X11; test.yml runs this explicitly under Xvfb"]
    fn real_tao_x11_decorations() {
        let event_loop = EventLoopBuilder::<()>::new().with_any_thread(true).build();
        let window = WindowBuilder::new()
            .with_visible(false)
            .build(&event_loop)
            .expect("create real Tao X11 window");
        let native = window.gtk_window();
        assert_eq!(native.display().type_().name(), "GdkX11Display");
        let titlebar = native.titlebar();
        enable_header_buttons(native);
        assert_eq!(native.titlebar(), titlebar);
    }
}
