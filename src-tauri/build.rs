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
}
