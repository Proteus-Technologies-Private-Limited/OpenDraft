package com.proteus.opendraft

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.DocumentsContract
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : TauriActivity() {
    /**
     * Route the system Back button through the WebView's history.
     *
     * TauriActivity turns this off, so Back fell straight through to the
     * default Activity handler and *closed the app* — from Settings, the Beat
     * Board, or any secondary screen, the only "back" gesture on the platform
     * quit and discarded unsaved work. This is the Android form of issue #65.
     *
     * With it on, WryActivity registers a callback that calls goBack() while
     * the WebView has history (OpenDraft is a single-page app, so router
     * navigations are history entries) and only exits at the first screen,
     * which is what Android users expect.
     */
    override val handleBackNavigation: Boolean = true

    /**
     * Back at the first screen puts the app in the background instead of
     * destroying it.
     *
     * Once the WebView has no history left, WryActivity's back callback falls
     * through to `onBackPressed()`, whose default finishes the Activity. On
     * Android that tears down the WebView while the *process* survives — and
     * Wry only builds its WebView from `WryLifecycleObserver.onCreate`, which
     * is registered on `ProcessLifecycleOwner` and so runs once per process and
     * never again. Reopening from the launcher therefore recreated MainActivity
     * around a WebView nothing had rebuilt: a blank white page, with no script
     * and no JS running, until the process was killed by hand. Verified on the
     * emulator — the process id is unchanged across Back and the relaunch.
     *
     * Backgrounding the task keeps process and WebView alive, so reopening
     * resumes the script exactly as leaving by Home already did. If the task
     * cannot be moved (it is not the root of its own task) the default
     * behaviour still runs, rather than leaving Back doing nothing at all.
     */
    @Suppress("DEPRECATION", "MissingSuperCall")
    override fun onBackPressed() {
        if (!moveTaskToBack(true)) {
            super.onBackPressed()
        }
    }

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

        /**
         * Read a content:// document as raw bytes.
         *
         * The text path (ContentResolver + Scanner, in Rust) mangles anything
         * that is not UTF-8 text, which meant archive formats — .fadein is a
         * zip — could never be imported on Android at all.
         *
         * Done in Kotlin rather than JNI because minSdk is 24, so
         * InputStream.readAllBytes() (API 33) is unavailable and the
         * alternative is a hand-rolled read loop across the JNI boundary.
         * `context` is passed in because a companion object has none.
         *
         * Returns null on any failure; the Rust side turns that into a
         * user-facing error.
         */
        @JvmStatic
        fun readUriBytes(context: android.content.Context, uriString: String): ByteArray? {
            return try {
                val uri = android.net.Uri.parse(uriString)
                context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            } catch (e: Exception) {
                android.util.Log.e("OpenDraft", "[content-uri] readUriBytes failed: ${e.message}")
                null
            }
        }

        /** Request code for the document picker activity. */
        const val PICK_FILE_REQUEST = 42

        /** Request code for the export save-as activity. */
        const val EXPORT_FILE_REQUEST = 43

        /** Request code for the backup folder picker (ACTION_OPEN_DOCUMENT_TREE). */
        const val PICK_BACKUP_FOLDER_REQUEST = 44

        // ── Automatic backups ────────────────────────────────────────────
        // The backup folder is a SAF tree the writer picks once and OpenDraft
        // keeps writing snapshots into — Android's counterpart to the iOS
        // security-scoped folder bookmark. A persisted tree grant is the only
        // handle that survives a relaunch, which is what makes "turn backups
        // on today, find them next month" work.
        //
        // Everything here is Kotlin rather than JNI because the SAF calls are
        // cursor-shaped: a JNI transcription would be several hundred lines of
        // hand-rolled Cursor iteration for no gain. Each returns a String? and
        // uses null for failure, so a single JNI helper on the Rust side calls
        // all of them.

        /** Tree URI from the backup folder picker; "" when the user cancelled. */
        @JvmStatic
        var pickedBackupFolderUri: String? = null

        /** One row of a SAF directory listing. */
        private data class SafChild(
            val id: String,
            val name: String,
            val isDir: Boolean,
            val size: Long,
            val modified: Long,
        )

        /**
         * List one SAF directory. Returns an empty list rather than throwing:
         * an unreadable project folder must not make every other backup vanish
         * from the Recover dialog.
         */
        private fun listChildren(context: Context, treeUri: Uri, parentId: String): List<SafChild> {
            val out = mutableListOf<SafChild>()
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
            try {
                context.contentResolver.query(
                    childrenUri,
                    arrayOf(
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE,
                        DocumentsContract.Document.COLUMN_SIZE,
                        DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                    ),
                    null, null, null,
                )?.use { cursor ->
                    while (cursor.moveToNext()) {
                        val id = cursor.getString(0) ?: continue
                        val name = cursor.getString(1) ?: continue
                        val mime = cursor.getString(2) ?: ""
                        out.add(
                            SafChild(
                                id = id,
                                name = name,
                                isDir = mime == DocumentsContract.Document.MIME_TYPE_DIR,
                                size = if (cursor.isNull(3)) 0L else cursor.getLong(3),
                                modified = if (cursor.isNull(4)) 0L else cursor.getLong(4),
                            )
                        )
                    }
                }
            } catch (e: Exception) {
                android.util.Log.w("OpenDraft", "[backup] could not list $parentId: ${e.message}")
            }
            return out
        }

        /** The project subfolder, created if this is the first snapshot for it. */
        private fun findOrCreateFolder(
            context: Context,
            treeUri: Uri,
            parentId: String,
            name: String,
        ): String? {
            listChildren(context, treeUri, parentId)
                .firstOrNull { it.isDir && it.name == name }
                ?.let { return it.id }

            val created = DocumentsContract.createDocument(
                context.contentResolver,
                DocumentsContract.buildDocumentUriUsingTree(treeUri, parentId),
                DocumentsContract.Document.MIME_TYPE_DIR,
                name,
            )
            return created?.let { DocumentsContract.getDocumentId(it) }
        }

        /**
         * Write a snapshot into <tree>/<folderName>/<fileName>, replacing any
         * file already there. Returns the document URI, or null on failure.
         *
         * An existing file is reused rather than left for SAF to rename: two
         * snapshots a second apart share a filename, and letting the provider
         * make "name (1).odraft" would leave a file the pruner cannot parse and
         * so can never clean up.
         */
        @JvmStatic
        fun backupWriteFile(
            context: Context,
            treeUriString: String,
            folderName: String,
            fileName: String,
            contents: String,
        ): String? {
            return try {
                val treeUri = Uri.parse(treeUriString)
                val rootId = DocumentsContract.getTreeDocumentId(treeUri)
                val folderId = findOrCreateFolder(context, treeUri, rootId, folderName)
                    ?: return null

                val existing = listChildren(context, treeUri, folderId)
                    .firstOrNull { !it.isDir && it.name == fileName }
                val docUri = if (existing != null) {
                    DocumentsContract.buildDocumentUriUsingTree(treeUri, existing.id)
                } else {
                    // octet-stream keeps the .odraft extension intact; a more
                    // specific MIME type makes SAF rewrite the name.
                    DocumentsContract.createDocument(
                        context.contentResolver,
                        DocumentsContract.buildDocumentUriUsingTree(treeUri, folderId),
                        "application/octet-stream",
                        fileName,
                    ) ?: return null
                }

                // "wt" truncates: plain "w" would leave the tail of a longer
                // previous snapshot appended to a shorter new one.
                context.contentResolver.openOutputStream(docUri, "wt")?.use {
                    it.write(contents.toByteArray(Charsets.UTF_8))
                } ?: return null

                docUri.toString()
            } catch (e: Exception) {
                android.util.Log.e("OpenDraft", "[backup] write failed: ${e.message}")
                null
            }
        }

        /**
         * Every .odraft in the backup folder and its project subfolders, as a
         * JSON array. Descends exactly one level, matching the desktop listing.
         * Returns null only when the folder itself could not be read — an empty
         * folder is "[]", which means "no backups yet" rather than "gone".
         */
        @JvmStatic
        fun backupList(context: Context, treeUriString: String): String? {
            return try {
                val treeUri = Uri.parse(treeUriString)
                val rootId = DocumentsContract.getTreeDocumentId(treeUri)
                val out = JSONArray()

                fun add(child: SafChild, project: String) {
                    if (!child.name.endsWith(".odraft", ignoreCase = true)) return
                    val uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, child.id)
                    out.put(
                        JSONObject()
                            .put("name", child.name)
                            .put("path", uri.toString())
                            .put("project", project)
                            .put("size", child.size)
                            .put("modified_ms", child.modified)
                    )
                }

                for (child in listChildren(context, treeUri, rootId)) {
                    if (child.isDir) {
                        for (file in listChildren(context, treeUri, child.id)) {
                            if (!file.isDir) add(file, child.name)
                        }
                    } else {
                        add(child, "")
                    }
                }
                out.toString()
            } catch (e: Exception) {
                android.util.Log.e("OpenDraft", "[backup] list failed: ${e.message}")
                null
            }
        }

        /** Delete one snapshot by document URI. Returns "1" on success. */
        @JvmStatic
        fun backupDeleteFile(context: Context, docUriString: String): String? {
            return try {
                val ok = DocumentsContract.deleteDocument(
                    context.contentResolver, Uri.parse(docUriString)
                )
                if (ok) "1" else null
            } catch (e: Exception) {
                android.util.Log.e("OpenDraft", "[backup] delete failed: ${e.message}")
                null
            }
        }

        /**
         * Whether the backup folder is still there and still writable, as JSON
         * matching the desktop probe ({exists, is_dir, writable, name, error}).
         *
         * Checked against the persisted grant and the folder's own flags rather
         * than by writing a probe file: a revoked grant is the failure that
         * actually happens on Android — the writer moves the folder, or clears
         * the app's access from Settings — and it needs saying in those words.
         */
        @JvmStatic
        fun backupProbeFolder(context: Context, treeUriString: String): String? {
            val probe = JSONObject()
            try {
                val treeUri = Uri.parse(treeUriString)
                val granted = context.contentResolver.persistedUriPermissions.any {
                    it.uri == treeUri && it.isWritePermission
                }

                val rootId = DocumentsContract.getTreeDocumentId(treeUri)
                val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootId)
                var exists = false
                var isDir = false
                var name = ""
                var canCreate = false

                context.contentResolver.query(
                    docUri,
                    arrayOf(
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE,
                        DocumentsContract.Document.COLUMN_FLAGS,
                    ),
                    null, null, null,
                )?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        exists = true
                        name = cursor.getString(0) ?: ""
                        isDir = cursor.getString(1) == DocumentsContract.Document.MIME_TYPE_DIR
                        val flags = if (cursor.isNull(2)) 0 else cursor.getInt(2)
                        canCreate =
                            (flags and DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE) != 0
                    }
                }

                probe.put("exists", exists)
                probe.put("is_dir", isDir)
                probe.put("writable", exists && isDir && granted && canCreate)
                probe.put("name", name)
                if (!exists) {
                    probe.put(
                        "error",
                        "The backup folder could not be found. It may have been moved or deleted."
                    )
                } else if (!isDir) {
                    probe.put("error", "Not a folder")
                } else if (!granted) {
                    probe.put(
                        "error",
                        "OpenDraft no longer has permission to this folder — choose it again."
                    )
                } else if (!canCreate) {
                    probe.put("error", "This folder does not allow new files")
                }
            } catch (e: Exception) {
                android.util.Log.e("OpenDraft", "[backup] probe failed: ${e.message}")
                return try {
                    JSONObject()
                        .put("exists", false)
                        .put("is_dir", false)
                        .put("writable", false)
                        .put("error", e.message ?: "Could not read the backup folder")
                        .toString()
                } catch (_: Exception) {
                    null
                }
            }
            return probe.toString()
        }
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
                        // Persist read AND write, so a document opened from
                        // Drive/Dropbox can be saved back to — including in a
                        // later session (issue #62). Write is requested
                        // separately: some providers grant read but not write,
                        // and asking for both at once fails the whole call,
                        // which would lose read access too.
                        try {
                            contentResolver.takePersistableUriPermission(
                                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                            )
                        } catch (_: Exception) {}
                        try {
                            contentResolver.takePersistableUriPermission(
                                uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                            )
                        } catch (e: Exception) {
                            android.util.Log.i(
                                "OpenDraft",
                                "[file-picker] no persistable write access: ${e.message}"
                            )
                        }
                        pickedFileUri = uri.toString()
                        android.util.Log.i("OpenDraft", "[file-picker] picked URI: $pickedFileUri")
                    }
                } else {
                    pickedFileUri = ""
                    android.util.Log.i("OpenDraft", "[file-picker] user cancelled")
                }
            }
            PICK_BACKUP_FOLDER_REQUEST -> {
                if (resultCode == RESULT_OK) {
                    val treeUri = data?.data
                    if (treeUri == null) {
                        // Nothing came back. Reported as a cancellation so the
                        // frontend stops polling instead of waiting out its
                        // timeout on a picker that has already closed.
                        pickedBackupFolderUri = ""
                        android.util.Log.w("OpenDraft", "[backup] folder pick returned no URI")
                    } else {
                        // Read and write together for a tree: unlike a single
                        // document, a folder OpenDraft cannot write to is of no
                        // use as a backup destination, so a partial grant is a
                        // failure worth reporting rather than working around.
                        try {
                            contentResolver.takePersistableUriPermission(
                                treeUri,
                                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                            )
                            pickedBackupFolderUri = treeUri.toString()
                            android.util.Log.i(
                                "OpenDraft", "[backup] folder picked: $pickedBackupFolderUri"
                            )
                        } catch (e: Exception) {
                            pickedBackupFolderUri = ""
                            android.util.Log.e(
                                "OpenDraft",
                                "[backup] could not persist folder permission: ${e.message}"
                            )
                        }
                    }
                } else {
                    pickedBackupFolderUri = ""
                    android.util.Log.i("OpenDraft", "[backup] folder pick cancelled")
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
