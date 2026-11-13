package com.proteus.opendraft

/** Compile-only stand-in for Wry/Tauri's generated Activity. No Rust runtime
 * is loaded in these tests. The production APK still uses Tauri's Activity. */
open class TauriActivity : androidx.appcompat.app.AppCompatActivity() {
    open val handleBackNavigation: Boolean = true
    open fun onWebViewCreate(webView: android.webkit.WebView) {}
}
