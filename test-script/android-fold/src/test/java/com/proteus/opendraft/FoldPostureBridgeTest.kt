package com.proteus.opendraft

import android.graphics.Rect
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.core.util.Consumer
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowLayoutInfo
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28, 35], manifest = Config.NONE)
class FoldPostureBridgeTest {
    @Test fun realJetpackAdapterWithoutOemFeaturesDoesNotInventCapability() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        val view = WebView(controller.get())
        val bridge = FoldPostureBridge.attach(controller.get(), view)
        assertNotNull(bridge)
        assertFalse(JSONObject(bridge!!.snapshot()).getBoolean("confirmed"))
        controller.pause().stop().destroy()
        assertNull(shadowOf(view).getJavascriptInterface(FoldPostureBridge.INTERFACE))
    }

    private class Source : FoldPostureBridge.LayoutSource {
        var callback: Consumer<WindowLayoutInfo>? = null
        var starts = 0
        var stops = 0
        var fail = false
        override fun start(consumer: Consumer<WindowLayoutInfo>) {
            starts++
            callback = consumer
            if (fail) throw IllegalStateException("synthetic OEM failure")
            emit()
        }
        override fun stop(consumer: Consumer<WindowLayoutInfo>) { stops++ }
        fun emit(feature: FoldingFeature? = null) {
            callback?.accept(WindowLayoutInfo(if (feature == null) emptyList() else listOf(feature)))
        }
    }
    private class Fold(
        private val rect: Rect = Rect(390, 0, 410, 800),
        override val state: FoldingFeature.State = FoldingFeature.State.HALF_OPENED,
        override val orientation: FoldingFeature.Orientation = FoldingFeature.Orientation.VERTICAL,
    ) : FoldingFeature {
        override val bounds get() = Rect(rect)
        override val isSeparating = true
        override val occlusionType = FoldingFeature.OcclusionType.FULL
    }

    @Test fun observesOnlyWhileStartedAndIgnoresLateCallbacks() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).create()
        val activity = controller.get()
        val source = Source()
        val view = WebView(activity)
        val bridge = FoldPostureBridge(activity, view, source)
        assertSame(bridge, shadowOf(view).getJavascriptInterface(FoldPostureBridge.INTERFACE))
        assertEquals(0, source.starts)
        controller.start().resume()
        assertEquals(1, source.starts)
        source.emit(Fold())
        assertTrue(JSONObject(bridge.snapshot()).getBoolean("confirmed"))
        val previousRegistration = source.callback!!
        controller.pause().stop()
        assertEquals(1, source.stops)
        val stopped = bridge.snapshot()
        source.emit(Fold(Rect(0, 390, 800, 410), orientation = FoldingFeature.Orientation.HORIZONTAL))
        assertEquals(stopped, bridge.snapshot())
        assertFalse(JSONObject(stopped).getBoolean("active"))
        assertTrue(JSONObject(stopped).isNull("feature"))
        controller.restart().start().resume()
        assertEquals(2, source.starts)
        assertTrue(JSONObject(bridge.snapshot()).getBoolean("confirmed"))
        val resumed = bridge.snapshot()
        previousRegistration.accept(WindowLayoutInfo(listOf(Fold())))
        assertEquals(resumed, bridge.snapshot())
        controller.pause().stop().destroy()
        assertNull(shadowOf(view).getJavascriptInterface(FoldPostureBridge.INTERFACE))
        val destroyed = bridge.snapshot()
        source.emit(Fold())
        assertEquals(destroyed, bridge.snapshot())
    }

    @Test fun suppliesWindowPixelBoundsAndRetainsObservedCapabilityOnCover() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        val activity = controller.get()
        val view = WebView(activity)
        // Robolectric's WebView has no rendering provider: set the native View
        // frame explicitly. This tests snapshot geometry, not WebView layout.
        ReflectionHelpers.setField(view, "mLeft", 20)
        ReflectionHelpers.setField(view, "mTop", 40)
        ReflectionHelpers.setField(view, "mRight", 820)
        ReflectionHelpers.setField(view, "mBottom", 840)
        val source = Source()
        val bridge = FoldPostureBridge(activity, view, source)
        assertEquals(800, view.width)
        assertFalse(JSONObject(bridge.snapshot()).getBoolean("confirmed"))
        source.emit(Fold())
        val first = JSONObject(bridge.snapshot())
        assertEquals(800, first.getJSONObject("webView").getInt("width"))
        assertEquals(390, first.getJSONObject("feature").getInt("left"))
        assertTrue(first.getJSONObject("feature").getBoolean("folded"))
        ReflectionHelpers.setField(view, "mRight", 720)
        view.viewTreeObserver.dispatchOnGlobalLayout()
        assertEquals(700, JSONObject(bridge.snapshot()).getJSONObject("webView").getInt("width"))
        source.emit()
        val cover = JSONObject(bridge.snapshot())
        assertTrue(cover.getBoolean("confirmed"))
        assertTrue(cover.isNull("feature"))
        controller.pause().stop().destroy()
    }

    @Test fun flatFeatureConfirmsCapabilityWithoutClaimingHalfOpen() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        val source = Source()
        val bridge = FoldPostureBridge(controller.get(), WebView(controller.get()), source)
        source.emit(Fold(Rect(400, 0, 400, 800), state = FoldingFeature.State.FLAT))
        val snapshot = JSONObject(bridge.snapshot())
        assertTrue(snapshot.getBoolean("confirmed"))
        assertFalse(snapshot.getJSONObject("feature").getBoolean("folded"))
        controller.pause().stop().destroy()
    }

    @Test fun emptyOrInvalidFeaturesNeverConfirmAnOrdinaryPhone() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        val source = Source()
        val bridge = FoldPostureBridge(controller.get(), WebView(controller.get()), source)
        source.emit(Fold(Rect(0, 0, 0, 0)))
        assertFalse(JSONObject(bridge.snapshot()).getBoolean("confirmed"))
        source.emit(Fold(Rect(-1, 0, 20, 800)))
        assertFalse(JSONObject(bridge.snapshot()).getBoolean("confirmed"))
        controller.pause().stop().destroy()
    }

    @Test fun separateWindowsAndNewActivitiesDoNotShareCapability() {
        val first = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        val second = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        val source = Source()
        val a = FoldPostureBridge(first.get(), WebView(first.get()), source)
        val b = FoldPostureBridge(second.get(), WebView(second.get()), Source())
        source.emit(Fold())
        assertTrue(JSONObject(a.snapshot()).getBoolean("confirmed"))
        assertFalse(JSONObject(b.snapshot()).getBoolean("confirmed"))
        first.pause().stop().destroy()
        second.pause().stop().destroy()
    }

    @Test fun failingWindowManagerLeavesAReadOnlyUnavailableSnapshot() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        val source = Source().apply { fail = true }
        val bridge = FoldPostureBridge(controller.get(), WebView(controller.get()), source)
        val snapshot = JSONObject(bridge.snapshot())
        assertEquals("unavailable", snapshot.getString("status"))
        assertFalse(snapshot.getBoolean("confirmed"))
        assertFalse(bridge.snapshot().contains("OEM"))
        assertNotNull(FoldPostureBridge::class.java.getMethod("snapshot").getAnnotation(JavascriptInterface::class.java))
        controller.pause().stop().destroy()
    }
}
