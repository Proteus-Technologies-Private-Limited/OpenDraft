package com.proteus.opendraft

import android.view.WindowManager.LayoutParams
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * keepKeyboardStateOnReturn (WindowActivities.kt): a keyboard the writer
 * closed must stay closed when a window comes back, without changing how the
 * window resizes for the keyboard.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28, 35], manifest = Config.NONE)
class KeyboardStateTest {
    private fun mode(activity: ComponentActivity) = activity.window.attributes.softInputMode

    @Test fun undeclaredModeKeepsTheKeyboardAsLeftAndStillResizes() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).create().get()
        assertEquals(LayoutParams.SOFT_INPUT_ADJUST_UNSPECIFIED, mode(activity) and LayoutParams.SOFT_INPUT_MASK_ADJUST)
        activity.keepKeyboardStateOnReturn()
        assertEquals(LayoutParams.SOFT_INPUT_STATE_UNCHANGED, mode(activity) and LayoutParams.SOFT_INPUT_MASK_STATE)
        // Setting the state on its own would turn an unspecified adjust into
        // "pan"; the resize these windows had before is kept explicitly.
        @Suppress("DEPRECATION")
        assertEquals(LayoutParams.SOFT_INPUT_ADJUST_RESIZE, mode(activity) and LayoutParams.SOFT_INPUT_MASK_ADJUST)
    }

    @Config(sdk = [28])
    @Test fun saysNothingBeforeAndroid11WhereTheInsetsCannotTell() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        val view = WebView(activity)
        KeyboardVisibility.attach(view)
        assertNull(shadowOf(view).getJavascriptInterface(KeyboardVisibility.INTERFACE))
    }

    @Config(sdk = [35])
    @Test fun reportsKeyboardVisibilityAndPassesInsetsOn() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        var reachedWebView = 0
        val view = object : WebView(activity) {
            override fun onApplyWindowInsets(insets: android.view.WindowInsets): android.view.WindowInsets {
                reachedWebView++
                return super.onApplyWindowInsets(insets)
            }
        }
        KeyboardVisibility.attach(view)
        val report = shadowOf(view).getJavascriptInterface(KeyboardVisibility.INTERFACE) as KeyboardVisibility
        assertFalse(report.isVisible())
        fun dispatch(imeVisible: Boolean) = ViewCompat.dispatchApplyWindowInsets(view,
            WindowInsetsCompat.Builder()
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, if (imeVisible) 800 else 0))
                .setVisible(WindowInsetsCompat.Type.ime(), imeVisible)
                .build())
        dispatch(true)
        assertTrue(report.isVisible())
        dispatch(false)
        assertFalse(report.isVisible())
        // The WebView's own inset handling (safe areas) still runs.
        assertEquals(2, reachedWebView)
    }

    @Test fun aDeclaredAdjustModeIsLeftAlone() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).create().get()
        activity.window.setSoftInputMode(LayoutParams.SOFT_INPUT_ADJUST_PAN or LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
        activity.keepKeyboardStateOnReturn()
        assertEquals(LayoutParams.SOFT_INPUT_ADJUST_PAN, mode(activity) and LayoutParams.SOFT_INPUT_MASK_ADJUST)
        assertEquals(LayoutParams.SOFT_INPUT_STATE_UNCHANGED, mode(activity) and LayoutParams.SOFT_INPUT_MASK_STATE)
    }
}
