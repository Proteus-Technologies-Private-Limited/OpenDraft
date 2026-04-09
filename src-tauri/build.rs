fn main() {
    tauri_build::build();

    // Compile Objective-C helpers for iOS so symbols are available at cargo link time.
    // FileHelpers.m defines ios_present_share_sheet, ios_read_text_file, ios_free_string
    // which are called from lib.rs via extern "C".
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "ios" {
        cc::Build::new()
            .file("gen/apple/Sources/opendraft/FileHelpers.m")
            .flag("-fobjc-arc")
            .compile("file_helpers");
        println!("cargo:rustc-link-lib=framework=UIKit");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }
}
