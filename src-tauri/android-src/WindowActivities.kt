package com.proteus.opendraft

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Per-WebView keyboard visibility and usable bottom edge, in window pixels.
 * `OpenDraftKeyboard.isVisible()` keeps its existing focus-restoration contract;
 * `snapshot()` supplies immutable geometry and a payload-free change event.
 *
 * The page cannot see it. These windows are edge to edge, so on Android 15
 * the keyboard covers the WebView without resizing it, and nothing in the
 * viewport changes. But a panel that moves between the dock and the floating
 * layer has to put focus back in its field afterwards (utils/movePanelHost),
 * and a scripted focus raises the keyboard — so folding or unfolding with the
 * writing pad focused opened a keyboard the writer had closed. Knowing it was
 * down, the page can put the caret back without raising it.
 *
 * The insets carry the answer whether or not anything resizes. The listener
 * passes every inset on to the WebView unchanged, so its own safe-area
 * handling (env(safe-area-inset-*)) is untouched. JavaScript interfaces run on
 * a WebView thread, so they read a volatile copy written on the main thread.
 *
 * Android 11 (API 30) is the first to say in the insets whether the keyboard
 * is showing; before it the answer would be a guess. There the interface is
 * not added at all, and the page keeps its previous behaviour.
 */
internal class KeyboardVisibility private constructor(private val webView: WebView) : androidx.lifecycle.DefaultLifecycleObserver {
    @Volatile private var visible = false
    @Volatile private var cached = "{\"version\":1,\"available\":false}"
    private var lastInsets: WindowInsetsCompat? = null
    private var destroyed = false
    private val layoutListener = android.view.ViewTreeObserver.OnGlobalLayoutListener { publish() }

    @JavascriptInterface
    fun isVisible(): Boolean = visible

    /** Immutable window-pixel geometry. No view access on the JavaScript thread. */
    @JavascriptInterface
    fun snapshot(): String = cached

    private fun publish() {
        if (destroyed) return
        val insets = lastInsets ?: return
        val location = IntArray(2)
        val rootLocation = IntArray(2)
        webView.getLocationInWindow(location)
        webView.rootView.getLocationInWindow(rootLocation)
        val height = webView.height
        val width = webView.width
        val safeTop = (rootLocation[1] + insets.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        ).top - location[1]).coerceIn(0, height)
        val bottom = if (visible) {
            (rootLocation[1] + webView.rootView.height - insets.getInsets(WindowInsetsCompat.Type.ime()).bottom - location[1]).coerceIn(0, height)
        } else height
        val next = org.json.JSONObject().put("version", 1).put("available", width > 0 && height > 0)
            .put("visible", visible).put("top", safeTop).put("width", width).put("height", height).put("bottom", bottom).toString()
        if (next == cached) return
        cached = next
        try {
            webView.evaluateJavascript("window.dispatchEvent(new Event('opendraft:keyboardchange'))", null)
        } catch (_: IllegalStateException) { /* WebView teardown; a later page reads the cached report. */ }
    }

    override fun onDestroy(owner: androidx.lifecycle.LifecycleOwner) {
        destroyed = true
        if (webView.viewTreeObserver.isAlive) webView.viewTreeObserver.removeOnGlobalLayoutListener(layoutListener)
        ViewCompat.setOnApplyWindowInsetsListener(webView, null)
        webView.removeJavascriptInterface(INTERFACE)
        owner.lifecycle.removeObserver(this)
    }

    companion object {
        const val INTERFACE = "OpenDraftKeyboard"

        fun attach(webView: WebView, owner: androidx.lifecycle.LifecycleOwner) {
            if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) return
            try {
                val tracker = KeyboardVisibility(webView)
                ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
                    tracker.visible = insets.isVisible(WindowInsetsCompat.Type.ime())
                    tracker.lastInsets = insets
                    tracker.publish()
                    ViewCompat.onApplyWindowInsets(view, insets)
                }
                webView.addJavascriptInterface(tracker, INTERFACE)
                webView.viewTreeObserver.addOnGlobalLayoutListener(tracker.layoutListener)
                owner.lifecycle.addObserver(tracker)
                ViewCompat.requestApplyInsets(webView)
            } catch (e: RuntimeException) {
                // The page treats a missing interface as "unknown" and keeps its
                // old behaviour; a window without it must still open.
                android.util.Log.w("OpenDraft", "[keyboard] could not report keyboard visibility: ${e.message}")
            }
        }
    }
}

/**
 * Leave the soft keyboard as the writer left it when a window comes back.
 *
 * The manifest declares no windowSoftInputMode, so the keyboard state is
 * "unspecified", and with the resize behaviour Android picks for the WebView
 * that means: whenever the window is brought forward with a text editor
 * focused, show the keyboard. The script (or the writing pad) keeps focus
 * after Back closes the keyboard, so returning from Home or the app switcher,
 * closing a second window, or folding onto the cover screen opened the
 * keyboard again unasked, over half the cover screen.
 *
 * STATE_UNCHANGED keeps it as it was instead: closed stays closed, and a
 * keyboard that was open when the writer left is open again on return. A tap
 * on the script still opens it, because the WebView asks for it directly.
 *
 * The adjust half has to be set as well. Left unspecified, Android chose
 * "resize" for these windows, but it only makes that choice for a window
 * whose mode was never set; once this sets the state, an unspecified adjust
 * comes out as "pan", which slides the whole window up under the keyboard
 * instead of shrinking the WebView. So keep "resize" explicitly, unless the
 * manifest ever asks for something else.
 */
@Suppress("DEPRECATION") // ADJUST_RESIZE: the behaviour these windows already had
internal fun Activity.keepKeyboardStateOnReturn() {
    val declared = window.attributes.softInputMode and WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST
    val adjust = if (declared == WindowManager.LayoutParams.SOFT_INPUT_ADJUST_UNSPECIFIED) {
        WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
    } else {
        declared
    }
    window.setSoftInputMode(adjust or WindowManager.LayoutParams.SOFT_INPUT_STATE_UNCHANGED)
}

/**
 * The extra windows OpenDraft can put on screen (issue #63).
 *
 * On iPadOS a second window is a second UIScene the system hands the app; on
 * Android it is a second Activity, and tao starts it by name — it looks the
 * class up with `Class.forName("com.proteus.opendraft.WindowActivityN")` and
 * calls `startActivity`. So the ceiling on windows is however many classes
 * exist here and are declared in AndroidManifest.xml; `open_new_window` in
 * lib.rs keeps its own count in step (ANDROID_EXTRA_WINDOWS).
 *
 * They deliberately do *not* carry MainActivity's companion object. Its statics
 * are the hand-off points for the file picker and the share sheet, which Rust
 * reaches through the main activity's context — one set of slots for the app,
 * not one per window.
 */
open class WindowActivity : TauriActivity() {
    override fun onWebViewCreate(webView: android.webkit.WebView) {
        super.onWebViewCreate(webView)
        FoldPostureBridge.attach(this, webView)
        KeyboardVisibility.attach(webView, this)
    }

    /**
     * Same reason as MainActivity: without this, WryActivity never registers a
     * back callback and the system Back gesture closes the window outright
     * instead of walking back through the app's own screens (issue #65).
     */
    override val handleBackNavigation: Boolean = true

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        MainActivity.handleDictationResult(requestCode, resultCode, data)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Matches MainActivity so a second window has the same transparent
        // system bars, and so the WebView sees the real safe-area insets.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        keepKeyboardStateOnReturn()
    }
}

class WindowActivity1 : WindowActivity()

class WindowActivity2 : WindowActivity()

class WindowActivity3 : WindowActivity()
