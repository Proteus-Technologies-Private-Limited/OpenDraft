//! The native side of popped-out panels.
//!
//! A popped-out panel is a window the editor page opens with
//! `window.open('about:blank')`, which wry builds for us when the new-window
//! handler answers `Allow` (see `desktop_windows::with_panel_windows`). wry
//! gives that window only a bare web view, so on its own:
//!
//! - macOS: `window.close()` does nothing (no WKUIDelegate to receive
//!   `webViewDidClose:`), so returning a panel to its dock left an empty
//!   window behind; the title bar stays blank; `window.focus()` does nothing;
//!   and the page cannot see where its windows are (`screenX`, `outerWidth`…
//!   come from a delegate wry does not implement), so it can neither remember
//!   a window's place nor keep a new one off an old one.
//! - Linux: `window.close()` destroys the web view but leaves its GTK window
//!   open and empty, titled "about:blank", at GTK's default size.
//!
//! Each new panel window is adopted here right after wry has built it: closing
//! the page closes the window, the window shows the page's title, and an
//! editor's panel windows close when the editor window is destroyed (the page
//! asks for that too, on `pagehide`; this is the backstop). The page then
//! names the window it opened (`tag`), and from then on asks for it by that
//! id: to place it, bring it forward, and read where it is.
//!
//! Windows needs none of this: WebView2 builds its own popup window, which
//! already closes with the page, shows its title and reports its frame.

/// Where a window is, in logical pixels from the top left of the main display.
#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
pub struct Frame {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

/// Adopt the panel window wry is about to create for `editor`. Called from the
/// new-window handler, before wry has made the window, so the work is queued
/// behind it on the main thread.
pub fn adopt_after_open(editor: &str) {
    let editor = editor.to_string();
    #[cfg(target_os = "macos")]
    dispatch2::DispatchQueue::main().exec_async(move || imp::adopt(&editor));
    #[cfg(target_os = "linux")]
    gtk::glib::idle_add_local_once(move || imp::adopt(&editor));
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = editor;
}

/// Name the panel window `editor` opened last, and put it at `frame`. Main
/// thread. False when there is none to name (Windows: none is adopted).
pub fn tag(editor: &str, id: &str, frame: Option<Frame>) -> bool {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return imp::tag(editor, id, frame);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (editor, id, frame);
        false
    }
}

/// Bring a panel window of `editor` forward. Main thread.
pub fn focus(editor: &str, id: &str) -> bool {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return imp::focus(editor, id);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (editor, id);
        false
    }
}

/// Where each of `editor`'s named panel windows is. Main thread.
pub fn frames(editor: &str) -> Vec<(String, Frame)> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return imp::frames(editor);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = editor;
        Vec::new()
    }
}

/// Close every panel window `editor` opened. Main thread (window events).
pub fn close_for(editor: &str) {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    imp::close_for(editor);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = editor;
}

#[cfg(target_os = "macos")]
mod imp {
    use std::{cell::{Cell, RefCell}, ffi::c_void, ptr::{null_mut, NonNull}};

    use objc2::{
        define_class, msg_send,
        rc::{Retained, Weak},
        runtime::{AnyObject, NSObject, ProtocolObject},
        sel, ClassType, DefinedClass, MainThreadMarker, MainThreadOnly,
    };
    use objc2_app_kit::{NSApplication, NSEvent, NSEventMask, NSScreen, NSWindow, NSWindowDelegate};
    use objc2_foundation::{
        ns_string, NSDictionary, NSKeyValueChangeKey, NSKeyValueObservingOptions, NSNotification,
        NSObjectNSKeyValueObserverRegistration, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString,
    };
    use objc2_web_kit::{WKUIDelegate, WKWebView};

    use super::Frame;

    thread_local! {
        /// Adopted panel windows, oldest first. Main thread only.
        static PANELS: RefCell<Vec<Retained<PanelWindow>>> = const { RefCell::new(Vec::new()) };
        /// Whether the click-through monitor is installed.
        static CLICK_THROUGH: Cell<bool> = const { Cell::new(false) };
    }

    fn is_panel(window: &NSWindow) -> bool {
        PANELS.with(|panels| {
            panels.borrow().iter().any(|p| {
                !p.ivars().closed.get()
                    && p.ivars().window.load().is_some_and(|w| std::ptr::eq(&*w, window))
            })
        })
    }

    /// One click, not two, between a script window and its panel windows.
    ///
    /// AppKit spends the first click on a window that is not key making it
    /// key, so with a panel in front, clicking a button in the script window
    /// did nothing until it was clicked again (and the same the other way).
    /// While the app is active, a mouse-down on one of its windows that is not
    /// key, coming from or going to a panel window, makes that window key just
    /// before AppKit sees the click, which then reaches the page. Coming from
    /// another app, the first click still only brings OpenDraft forward, as
    /// usual on a Mac.
    fn install_click_through(mtm: MainThreadMarker) {
        if CLICK_THROUGH.with(|on| on.replace(true)) {
            return;
        }
        let block = block2::RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
            // SAFETY: AppKit passes a live event for the length of the call.
            let ev = unsafe { event.as_ref() };
            let app = NSApplication::sharedApplication(mtm);
            if app.isActive() {
                if let Some(target) = ev.window(mtm) {
                    if !target.isKeyWindow() && target.canBecomeKeyWindow() {
                        let from_panel = app.keyWindow().is_some_and(|key| is_panel(&key));
                        if from_panel || is_panel(&target) {
                            target.makeKeyAndOrderFront(None);
                        }
                    }
                }
            }
            event.as_ptr()
        });
        let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::LeftMouseDown, &block) };
        if monitor.is_none() {
            eprintln!("[panels] Could not watch clicks; switching windows will take two clicks");
            CLICK_THROUGH.with(|on| on.set(false));
            return;
        }
        // Both live as long as the app: AppKit holds the monitor, and the
        // block must outlive it.
        std::mem::forget(monitor);
        std::mem::forget(block);
    }

    pub struct Ivars {
        editor: String,
        /// The page's name for this window, once it has given one.
        id: RefCell<Option<String>>,
        window: Weak<NSWindow>,
        webview: Weak<WKWebView>,
        /// wry's own window delegate: it releases the window when it closes,
        /// so every windowWillClose: is passed on to it.
        wry_delegate: Option<Retained<ProtocolObject<dyn NSWindowDelegate>>>,
        observing_title: Cell<bool>,
        closed: Cell<bool>,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = Ivars]
        #[name = "OpenDraftPanelWindow"]
        pub struct PanelWindow;

        unsafe impl NSObjectProtocol for PanelWindow {}

        unsafe impl WKUIDelegate for PanelWindow {
            /// The page called window.close() (from the editor, or itself).
            #[unsafe(method(webViewDidClose:))]
            fn web_view_did_close(&self, _webview: &WKWebView) {
                if let Some(window) = self.ivars().window.load() {
                    window.close();
                }
            }
        }

        unsafe impl NSWindowDelegate for PanelWindow {
            #[unsafe(method(windowWillClose:))]
            fn window_will_close(&self, notification: &NSNotification) {
                eprintln!("[panels] Window {:?} of {} closing", self.ivars().id.borrow(), self.ivars().editor);
                self.closing();
                if let Some(wry) = &self.ivars().wry_delegate {
                    if wry.respondsToSelector(sel!(windowWillClose:)) {
                        let _: () = unsafe { msg_send![&**wry, windowWillClose: notification] };
                    }
                }
                // Dropped later: this object is still running.
                dispatch2::DispatchQueue::main().exec_async(forget_closed);
            }
        }

        /// NSKeyValueObserving: the page's title.
        impl PanelWindow {
            #[unsafe(method(observeValueForKeyPath:ofObject:change:context:))]
            fn observe_value(
                &self,
                key_path: Option<&NSString>,
                _object: Option<&AnyObject>,
                _change: Option<&NSDictionary<NSKeyValueChangeKey, AnyObject>>,
                _context: *mut c_void,
            ) {
                if key_path.is_some_and(|k| k.isEqualToString(ns_string!("title"))) {
                    self.show_title();
                }
            }
        }
    );

    impl PanelWindow {
        fn new(
            mtm: MainThreadMarker,
            editor: &str,
            window: &NSWindow,
            webview: &WKWebView,
        ) -> Retained<Self> {
            let this = mtm.alloc::<Self>().set_ivars(Ivars {
                editor: editor.to_string(),
                id: RefCell::new(None),
                window: Weak::from(window),
                webview: Weak::from(webview),
                wry_delegate: window.delegate(),
                observing_title: Cell::new(false),
                closed: Cell::new(false),
            });
            unsafe { msg_send![super(this), init] }
        }

        fn attach(&self, window: &NSWindow, webview: &WKWebView) {
            unsafe {
                webview.setUIDelegate(Some(ProtocolObject::from_ref(self)));
                webview.addObserver_forKeyPath_options_context(
                    self,
                    ns_string!("title"),
                    NSKeyValueObservingOptions::New,
                    null_mut(),
                );
            }
            self.ivars().observing_title.set(true);
            window.setDelegate(Some(ProtocolObject::from_ref(self)));
            self.show_title();
        }

        fn show_title(&self) {
            let (Some(window), Some(webview)) =
                (self.ivars().window.load(), self.ivars().webview.load())
            else {
                return;
            };
            if let Some(title) = unsafe { webview.title() } {
                if title.length() > 0 {
                    window.setTitle(&title);
                }
            }
        }

        /// Undo everything attach() did, before wry releases the web view.
        fn closing(&self) {
            if self.ivars().closed.replace(true) {
                return;
            }
            if let Some(webview) = self.ivars().webview.load() {
                unsafe {
                    if self.ivars().observing_title.replace(false) {
                        webview.removeObserver_forKeyPath(self, ns_string!("title"));
                    }
                    webview.setUIDelegate(None);
                }
            }
            if let Some(window) = self.ivars().window.load() {
                let wry = self.ivars().wry_delegate.as_deref();
                window.setDelegate(wry);
            }
        }

        fn live_window(&self, editor: &str) -> Option<Retained<NSWindow>> {
            if self.ivars().editor != editor || self.ivars().closed.get() {
                return None;
            }
            self.ivars().window.load()
        }
    }

    fn forget_closed() {
        PANELS.with(|panels| panels.borrow_mut().retain(|p| !p.ivars().closed.get()));
    }

    /// AppKit measures from the bottom left of the main display; the page,
    /// like the rest of the app, from its top left.
    fn main_display_height(mtm: MainThreadMarker) -> Option<f64> {
        NSScreen::screens(mtm).firstObject().map(|screen| screen.frame().size.height)
    }

    pub fn adopt(editor: &str) {
        let Some(mtm) = MainThreadMarker::new() else {
            eprintln!("[panels] Not on the main thread; panel window left as wry made it");
            return;
        };
        install_click_through(mtm);
        let app = NSApplication::sharedApplication(mtm);
        let mut adopted = 0;
        for window in app.windows().iter() {
            // Tauri's windows hold their web view inside a container view; only
            // a window wry made for window.open() has a bare web view as its
            // content.
            let Some(view) = window.contentView() else { continue };
            if !view.isKindOfClass(WKWebView::class()) {
                continue;
            }
            let known = PANELS.with(|panels| {
                panels.borrow().iter().any(|p| {
                    p.ivars().window.load().is_some_and(|w| Retained::as_ptr(&w) == Retained::as_ptr(&window))
                })
            });
            if known {
                continue;
            }
            // SAFETY: checked with isKindOfClass above.
            let webview: Retained<WKWebView> = unsafe { Retained::cast_unchecked(view) };
            let panel = PanelWindow::new(mtm, editor, &window, &webview);
            panel.attach(&window, &webview);
            PANELS.with(|panels| panels.borrow_mut().push(panel));
            adopted += 1;
        }
        if adopted == 0 {
            eprintln!("[panels] No new panel window found to adopt for {editor}");
        }
    }

    pub fn tag(editor: &str, id: &str, frame: Option<Frame>) -> bool {
        let Some(mtm) = MainThreadMarker::new() else { return false };
        let window = PANELS.with(|panels| {
            let panels = panels.borrow();
            let newest = panels
                .iter()
                .rev()
                .find(|p| p.ivars().id.borrow().is_none() && p.live_window(editor).is_some())?;
            *newest.ivars().id.borrow_mut() = Some(id.to_string());
            newest.ivars().window.load()
        });
        let Some(window) = window else { return false };
        eprintln!("[panels] Window {id} of {editor} named; placing at {frame:?}");
        if let (Some(frame), Some(height)) = (frame, main_display_height(mtm)) {
            let rect = NSRect::new(
                NSPoint::new(frame.left, height - frame.top - frame.height),
                NSSize::new(frame.width, frame.height),
            );
            window.setFrame_display(rect, true);
        }
        true
    }

    fn find(editor: &str, id: &str) -> Option<Retained<NSWindow>> {
        PANELS.with(|panels| {
            panels.borrow().iter().find_map(|p| {
                (p.ivars().id.borrow().as_deref() == Some(id)).then(|| p.live_window(editor)).flatten()
            })
        })
    }

    pub fn focus(editor: &str, id: &str) -> bool {
        match find(editor, id) {
            Some(window) => {
                window.makeKeyAndOrderFront(None);
                true
            }
            None => false,
        }
    }

    pub fn frames(editor: &str) -> Vec<(String, Frame)> {
        let Some(mtm) = MainThreadMarker::new() else { return Vec::new() };
        let Some(height) = main_display_height(mtm) else { return Vec::new() };
        PANELS.with(|panels| {
            panels
                .borrow()
                .iter()
                .filter_map(|p| {
                    let id = p.ivars().id.borrow().clone()?;
                    let window = p.live_window(editor)?;
                    let f = window.frame();
                    Some((id, Frame {
                        left: f.origin.x,
                        top: height - f.origin.y - f.size.height,
                        width: f.size.width,
                        height: f.size.height,
                    }))
                })
                .collect()
        })
    }

    pub fn close_for(editor: &str) {
        let windows: Vec<Retained<NSWindow>> = PANELS.with(|panels| {
            panels.borrow().iter().filter_map(|p| p.live_window(editor)).collect()
        });
        for window in windows {
            window.close();
        }
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use gtk::prelude::*;
    use std::cell::RefCell;

    use super::Frame;

    struct Panel {
        editor: String,
        id: Option<String>,
        window: gtk::Window,
    }

    thread_local! {
        /// Adopted panel windows, oldest first. Main thread only.
        static PANELS: RefCell<Vec<Panel>> = const { RefCell::new(Vec::new()) };
    }

    const DEFAULT_SIZE: (i32, i32) = (380, 640);

    pub fn adopt(editor: &str) {
        let mut adopted = 0;
        for widget in gtk::Window::list_toplevels() {
            let Ok(window) = widget.downcast::<gtk::Window>() else { continue };
            // wry titles the window it makes for window.open() with its URL.
            if window.title().as_deref() != Some("about:blank") {
                continue;
            }
            if PANELS.with(|panels| panels.borrow().iter().any(|p| p.window == window)) {
                continue;
            }
            // wry's layout: window > box > web view.
            let Some(webview) = window
                .child()
                .and_then(|child| child.downcast::<gtk::Box>().ok())
                .and_then(|holder| holder.children().into_iter().next())
            else {
                continue;
            };
            window.set_title("");
            window.resize(DEFAULT_SIZE.0, DEFAULT_SIZE.1);
            // wry destroys the web view on window.close(); close its window too.
            let to_close = window.clone();
            webview.connect_local("close", true, move |_| {
                to_close.close();
                None
            });
            let to_title = window.clone();
            webview.connect_notify_local(Some("title"), move |view, _| {
                if let Some(title) = view.property::<Option<String>>("title") {
                    if !title.is_empty() {
                        to_title.set_title(&title);
                    }
                }
            });
            window.connect_destroy(|gone| {
                PANELS.with(|panels| panels.borrow_mut().retain(|p| p.window != *gone));
            });
            PANELS.with(|panels| {
                panels.borrow_mut().push(Panel { editor: editor.to_string(), id: None, window })
            });
            adopted += 1;
        }
        if adopted == 0 {
            eprintln!("[panels] No new panel window found to adopt for {editor}");
        }
    }

    pub fn tag(editor: &str, id: &str, frame: Option<Frame>) -> bool {
        let window = PANELS.with(|panels| {
            let mut panels = panels.borrow_mut();
            let newest = panels.iter_mut().rev().find(|p| p.editor == editor && p.id.is_none())?;
            newest.id = Some(id.to_string());
            Some(newest.window.clone())
        });
        let Some(window) = window else { return false };
        if let Some(frame) = frame {
            window.move_(frame.left.round() as i32, frame.top.round() as i32);
            window.resize(frame.width.round() as i32, frame.height.round() as i32);
        }
        true
    }

    fn find(editor: &str, id: &str) -> Option<gtk::Window> {
        PANELS.with(|panels| {
            panels
                .borrow()
                .iter()
                .find(|p| p.editor == editor && p.id.as_deref() == Some(id))
                .map(|p| p.window.clone())
        })
    }

    pub fn focus(editor: &str, id: &str) -> bool {
        match find(editor, id) {
            Some(window) => {
                window.present();
                true
            }
            None => false,
        }
    }

    pub fn frames(editor: &str) -> Vec<(String, Frame)> {
        PANELS.with(|panels| {
            panels
                .borrow()
                .iter()
                .filter(|p| p.editor == editor)
                .filter_map(|p| {
                    let id = p.id.clone()?;
                    let (left, top) = p.window.position();
                    let (width, height) = p.window.size();
                    Some((id, Frame {
                        left: left as f64,
                        top: top as f64,
                        width: width as f64,
                        height: height as f64,
                    }))
                })
                .collect()
        })
    }

    pub fn close_for(editor: &str) {
        let windows: Vec<gtk::Window> = PANELS.with(|panels| {
            panels.borrow().iter().filter(|p| p.editor == editor).map(|p| p.window.clone()).collect()
        });
        for window in windows {
            window.close();
        }
    }
}
