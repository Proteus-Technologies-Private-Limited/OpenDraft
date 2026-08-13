# Keep classes and methods called from Rust via JNI reflection.
# R8 cannot trace JNI calls, so these would be stripped without explicit rules.

# FileProvider — used by android_share_file() for export share intent
-keep class androidx.core.content.FileProvider {
    public static android.net.Uri getUriForFile(android.content.Context, java.lang.String, java.io.File);
}

# Extra window activities — started by name from Rust (issue #63), so nothing
# in the Kotlin sources references them and R8 would be free to rename them.
# The manifest entries keep them too; this states the JNI dependency outright.
-keep class com.proteus.opendraft.WindowActivity* { *; }

# MainActivity companion object — used for file picker, export, and new-intent communication
-keep class com.proteus.opendraft.MainActivity {
    public static *** getPickedFileUri();
    public static *** setPickedFileUri(java.lang.String);
    public static *** getNewIntentUri();
    public static *** setNewIntentUri(java.lang.String);
    public static *** getExportSourcePath();
    public static *** setExportSourcePath(java.lang.String);
    public static byte[] readUriBytes(android.content.Context, java.lang.String);
}
