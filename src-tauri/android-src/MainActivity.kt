package com.proteus.opendraft

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import java.io.File

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Explicit edge-to-edge opt-in with transparent bars using the
        // non-deprecated androidx.activity API. The no-arg enableEdgeToEdge()
        // form triggers Play Console's "Edge-to-edge may not display for all
        // users" warning on apps targeting Android 15+; passing SystemBarStyle
        // explicitly resolves it.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)

        // No parent-view padding — the WebView is full-bleed so HTML content
        // sees the real env(safe-area-inset-*) values and can place the menu
        // bar / page header below the status bar via CSS (see
        // frontend/src/styles/screenplay.css `.android` rules near
        // env(safe-area-inset-top)). Padding the parent here hides the inset
        // from the WebView, which produced the visible blank stripe above the
        // editor.
    }

    companion object {
        /** URI from a file picker (ACTION_OPEN_DOCUMENT) result. */
        @JvmStatic
        var pickedFileUri: String? = null

        /** URI from a warm-start "Open with" intent (onNewIntent). */
        @JvmStatic
        var newIntentUri: String? = null

        /** Path to the temp file being exported (set by Rust before launching save-as). */
        @JvmStatic
        var exportSourcePath: String? = null

        /** Request code for the document picker activity. */
        const val PICK_FILE_REQUEST = 42

        /** Request code for the export save-as activity. */
        const val EXPORT_FILE_REQUEST = 43
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Critical: update the Activity's intent so getIntent() returns the new one
        setIntent(intent)
        intent.data?.let { uri ->
            newIntentUri = uri.toString()
            android.util.Log.i("OpenDraft", "[file-assoc] onNewIntent URI: $newIntentUri")
        }
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            PICK_FILE_REQUEST -> {
                if (resultCode == RESULT_OK) {
                    data?.data?.let { uri ->
                        try {
                            contentResolver.takePersistableUriPermission(
                                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                            )
                        } catch (_: Exception) {}
                        pickedFileUri = uri.toString()
                        android.util.Log.i("OpenDraft", "[file-picker] picked URI: $pickedFileUri")
                    }
                } else {
                    pickedFileUri = ""
                    android.util.Log.i("OpenDraft", "[file-picker] user cancelled")
                }
            }
            EXPORT_FILE_REQUEST -> {
                if (resultCode == RESULT_OK) {
                    data?.data?.let { destUri ->
                        val srcPath = exportSourcePath
                        if (srcPath != null) {
                            try {
                                val srcFile = File(srcPath)
                                contentResolver.openOutputStream(destUri)?.use { out ->
                                    srcFile.inputStream().use { input ->
                                        input.copyTo(out)
                                    }
                                }
                                android.util.Log.i("OpenDraft", "[export] Saved to: $destUri")
                            } catch (e: Exception) {
                                android.util.Log.e("OpenDraft", "[export] Failed to save: ${e.message}")
                            } finally {
                                exportSourcePath = null
                            }
                        }
                    }
                } else {
                    exportSourcePath = null
                    android.util.Log.i("OpenDraft", "[export] user cancelled save-as")
                }
            }
        }
    }
}
