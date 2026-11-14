package com.proteus.opendraft

import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.annotation.Keep
import androidx.core.content.ContextCompat
import androidx.core.util.Consumer
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo
import org.json.JSONObject

/** Vendor WindowManager extensions may link against a different SDK. Keep
 * those optional failures contained without swallowing VM-fatal errors. */
private inline fun <T> optionalWindowCall(block: () -> T): T? = try {
    block()
} catch (_: Exception) {
    null
} catch (_: LinkageError) {
    null
}

/** Per-Activity geometry only. No script data, permissions or global device flag. */
@Keep
class FoldPostureBridge internal constructor(
    private val activity: ComponentActivity,
    private val webView: WebView,
    private val source: LayoutSource,
) : DefaultLifecycleObserver {
    internal interface LayoutSource {
        fun start(consumer: Consumer<WindowLayoutInfo>)
        fun stop(consumer: Consumer<WindowLayoutInfo>)
    }

    private class JetpackSource(private val activity: ComponentActivity) : LayoutSource {
        private val tracker = WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(activity))
        override fun start(consumer: Consumer<WindowLayoutInfo>) =
            tracker.addWindowLayoutInfoListener(activity, ContextCompat.getMainExecutor(activity), consumer)
        override fun stop(consumer: Consumer<WindowLayoutInfo>) = tracker.removeWindowLayoutInfoListener(consumer)
    }

    private val location = IntArray(2)
    private var confirmed = false
    private var started = false
    private var destroyed = false
    private var status = "pending"
    private var feature: FoldingFeature? = null
    private var generation = 0
    private var consumer: Consumer<WindowLayoutInfo>? = null
    // JavaScript interfaces run on a WebView thread. Only this immutable copy
    // crosses threads; Android views and WindowManager are read on the UI thread.
    @Volatile private var cached = "{\"version\":1,\"status\":\"pending\",\"active\":false,\"confirmed\":false}"
    private fun acceptLayout(info: WindowLayoutInfo) {
        status = "available"
        feature = info.displayFeatures.filterIsInstance<FoldingFeature>().firstOrNull { fold ->
            val r = fold.bounds
            r.left >= 0 && r.top >= 0 && r.width() >= 0 && r.height() >= 0 &&
                (r.width() > 0 || r.height() > 0)
        }
        if (feature != null) confirmed = true
        publish()
    }
    private val globalLayoutListener = android.view.ViewTreeObserver.OnGlobalLayoutListener { publish() }

    init {
        webView.addJavascriptInterface(this, INTERFACE)
        // Global layout also catches a WebView moving within its window without
        // changing size. Feature bounds are window pixels, not screen pixels/dp.
        webView.viewTreeObserver.addOnGlobalLayoutListener(globalLayoutListener)
        activity.lifecycle.addObserver(this)
    }

    @JavascriptInterface
    fun snapshot(): String = cached

    override fun onStart(owner: LifecycleOwner) {
        if (destroyed || started) return
        started = true
        status = "pending"
        feature = null
        publish()
        val token = ++generation
        val listener = Consumer<WindowLayoutInfo> { info ->
            if (started && !destroyed && token == generation) {
                if (optionalWindowCall { acceptLayout(info); true } != true) sourceUnavailable()
            }
        }
        consumer = listener
        if (optionalWindowCall { source.start(listener); true } != true) {
            sourceUnavailable()
        }
    }

    private fun sourceUnavailable() {
        // Unsupported OEM extensions must not prevent the editor opening.
        generation++
        val listener = consumer
        consumer = null
        if (listener != null) optionalWindowCall { source.stop(listener) }
        feature = null
        status = "unavailable"
        publish()
    }

    override fun onStop(owner: LifecycleOwner) {
        started = false
        generation++
        val listener = consumer
        consumer = null
        if (listener != null) {
            optionalWindowCall { source.stop(listener) }
        }
        feature = null
        status = "pending"
        publish()
    }

    override fun onDestroy(owner: LifecycleOwner) {
        onStop(owner)
        destroyed = true
        if (webView.viewTreeObserver.isAlive) webView.viewTreeObserver.removeOnGlobalLayoutListener(globalLayoutListener)
        webView.removeJavascriptInterface(INTERFACE)
        activity.lifecycle.removeObserver(this)
    }

    private fun publish() {
        if (destroyed) return
        webView.getLocationInWindow(location)
        val geometry = feature?.let { fold ->
            val r = fold.bounds
            JSONObject().put("left", r.left).put("top", r.top)
                .put("width", r.width()).put("height", r.height())
                .put("orientation", if (fold.orientation == FoldingFeature.Orientation.HORIZONTAL) "horizontal" else "vertical")
                .put("folded", fold.state == FoldingFeature.State.HALF_OPENED)
        }
        val next = JSONObject().put("version", 1).put("status", status)
            .put("active", started).put("confirmed", confirmed)
            .put("webView", JSONObject().put("left", location[0]).put("top", location[1])
                .put("width", webView.width).put("height", webView.height))
            .put("feature", geometry ?: JSONObject.NULL).toString()
        if (next == cached) return
        cached = next
        // A payload-free notification: the document pulls the latest snapshot,
        // including on first load. Never replace Tauri's WebViewClient or bridge.
        try {
            webView.evaluateJavascript("window.dispatchEvent(new Event('$EVENT'))", null)
        } catch (_: IllegalStateException) { /* WebView teardown; startup/resume pulls the snapshot. */ }
    }

    companion object {
        const val INTERFACE = "OpenDraftAndroidFold"
        const val EVENT = "opendraft:androidfoldchange"

        fun attach(activity: ComponentActivity, webView: WebView): FoldPostureBridge? = optionalWindowCall {
            FoldPostureBridge(activity, webView, JetpackSource(activity))
        }
    }
}
