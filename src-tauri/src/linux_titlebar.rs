//! GTK input routing for Tao 0.35's Wayland client-side title bar (#271).
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

    // One GTK thread for all cases. Run under xvfb-run in CI; no window manager
    // or physical device is needed to inspect native input-window ordering.
    #[test]
    fn only_tao_header_wrapper_changes() {
        gtk::init().expect("GTK display required: run with xvfb-run");
        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        enable_header_buttons(&window); // X11/server-side decorations.
        assert!(window.titlebar().is_none());

        let header = gtk::HeaderBar::new();
        window.set_titlebar(Some(&header));
        enable_header_buttons(&window); // A direct GTK header needs no patch.
        assert_eq!(window.titlebar(), Some(header.upcast()));

        let unrelated = gtk::EventBox::new();
        unrelated.set_above_child(true);
        unrelated.add(&gtk::Label::new(Some("Other decoration")));
        window.set_titlebar(Some(&unrelated));
        enable_header_buttons(&window);
        assert!(unrelated.is_above_child());

        let wrapper = gtk::EventBox::new();
        let header = gtk::HeaderBar::new();
        header.set_show_close_button(true);
        wrapper.add(&header);
        wrapper.set_above_child(true); // Exact Tao 0.35 Wayland structure.
        window.set_titlebar(Some(&wrapper));
        enable_header_buttons(&window);
        assert!(!wrapper.is_above_child());
        assert!(header.shows_close_button());
        enable_header_buttons(&window); // Safe on subsequent page loads.
        assert!(!wrapper.is_above_child());
        window.close();
    }
}
