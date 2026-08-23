fn main() {
    tauri_build::build();

    // On iOS, the Rust library declares extern "C" functions (ios_present_share_sheet,
    // ios_read_text_file, etc.) that are defined in FileHelpers.m. Xcode compiles
    // FileHelpers.m separately and links everything into the final binary, so the
    // staticlib (libapp.a) works fine — unresolved symbols are resolved at final link.
    //
    // However, cargo also builds a cdylib which requires all symbols resolved at
    // link time. The cdylib is never used on iOS (only the staticlib matters), so
    // we tell the linker to allow undefined symbols in it.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "ios" {
        println!("cargo:rustc-cdylib-link-arg=-Wl,-undefined,dynamic_lookup");
    }

    // Android 15 can run with 16 KB memory pages, and from November 2025 Google
    // Play refuses updates whose native libraries are not laid out for it. The
    // NDK's linker still defaults to 4 KB segment alignment (r28 is the first
    // release that flips the default), so ask for 16 KB explicitly — otherwise
    // libopendraft_lib.so loads on no 16 KB device and the Play Console rejects
    // the bundle.
    //
    // This belongs here rather than in .cargo/config.toml: the Tauri CLI sets
    // CARGO_TARGET_<TRIPLE>_RUSTFLAGS for every Android build (it adds -llog,
    // -landroid, -lOpenSLES), and that environment variable *replaces* a
    // target's rustflags from config, so anything written there is dropped on
    // the floor without a word. Link args emitted by a build script are added
    // to whatever the CLI passes instead of competing with it.
    //
    // Padding costs a few KB per ABI. The alignment that ships is verified off
    // the built APK in .github/workflows/release.yml.
    if target_os == "android" {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
    }
}
