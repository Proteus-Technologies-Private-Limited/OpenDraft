//! Fold posture for foldable iPhones (issue #231, WP4).
//!
//! WKWebView has none of the web fold APIs, so on iOS the page asks for the
//! native hinge instead. The command attaches a tracker (FoldPosture.m) to the
//! very web view that called it; from then on the tracker pushes posture into
//! that page itself, as `window.__opendraftNativeFold` and an
//! `opendraft:nativefold` event, which `utils/foldPosture.ts` reads.
//!
//! Everywhere else this answers `false` and the page keeps to the browser APIs.

#[cfg(target_os = "ios")]
extern "C" {
    fn ios_fold_attach(webview: *mut std::ffi::c_void) -> i32;
}

/// Start reporting the hinge to this web view. Resolves `true` once the
/// tracker attach has been handed to the main thread on iOS (whether the
/// device turns out to have a hinge is then the page's to learn from the
/// events), `false` on platforms with nothing to report.
#[tauri::command]
pub fn fold_watch_start(webview: tauri::Webview) -> Result<bool, String> {
    #[cfg(target_os = "ios")]
    {
        // with_webview runs the closure on the main thread, which is where
        // UIKit has to be touched.
        webview
            .with_webview(|platform| {
                let attached = unsafe { ios_fold_attach(platform.inner()) };
                if attached == 0 {
                    eprintln!("[fold] No hinge API on this iOS version; using browser detection only");
                }
            })
            .map_err(|error| format!("Could not reach the web view for fold posture: {error}"))?;
        Ok(true)
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = webview;
        Ok(false)
    }
}
