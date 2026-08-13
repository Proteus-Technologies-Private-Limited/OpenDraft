package com.proteus.opendraft

import android.graphics.Color
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge

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
    /**
     * Same reason as MainActivity: without this, WryActivity never registers a
     * back callback and the system Back gesture closes the window outright
     * instead of walking back through the app's own screens (issue #65).
     */
    override val handleBackNavigation: Boolean = true

    override fun onCreate(savedInstanceState: Bundle?) {
        // Matches MainActivity so a second window has the same transparent
        // system bars, and so the WebView sees the real safe-area insets.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
    }
}

class WindowActivity1 : WindowActivity()

class WindowActivity2 : WindowActivity()

class WindowActivity3 : WindowActivity()
