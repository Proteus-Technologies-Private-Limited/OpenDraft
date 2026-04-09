package com.proteus.opendraft

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import java.io.File

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
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
