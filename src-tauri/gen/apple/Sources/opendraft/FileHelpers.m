#import <UIKit/UIKit.h>
#import <Foundation/Foundation.h>

// ── iOS Share Sheet ─────────────────────────────────────────────────────────
// Present the native iOS share sheet for a file.
// Called from Rust via extern "C" for file exports on iOS.

void ios_present_share_sheet(const char* file_path) {
    if (!file_path) return;

    NSString *path = @(file_path);
    NSURL *fileURL = [NSURL fileURLWithPath:path];

    if (![[NSFileManager defaultManager] fileExistsAtPath:path]) {
        NSLog(@"[FileHelpers] share sheet: file does not exist at %@", path);
        return;
    }

    dispatch_async(dispatch_get_main_queue(), ^{
        UIActivityViewController *avc = [[UIActivityViewController alloc]
            initWithActivityItems:@[fileURL]
            applicationActivities:nil];

        // Find the foreground window's root view controller
        UIViewController *rootVC = nil;
        for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
            if ([scene isKindOfClass:[UIWindowScene class]] &&
                scene.activationState == UISceneActivationStateForegroundActive) {
                UIWindowScene *ws = (UIWindowScene *)scene;
                rootVC = ws.keyWindow.rootViewController;
                if (rootVC) break;
            }
        }
        if (!rootVC) {
            NSLog(@"[FileHelpers] share sheet: no root view controller found");
            return;
        }

        // Walk to the topmost presented VC
        while (rootVC.presentedViewController) {
            rootVC = rootVC.presentedViewController;
        }

        // iPad requires popover configuration
        if (avc.popoverPresentationController) {
            avc.popoverPresentationController.sourceView = rootVC.view;
            avc.popoverPresentationController.sourceRect = CGRectMake(
                CGRectGetMidX(rootVC.view.bounds),
                CGRectGetMidY(rootVC.view.bounds), 0, 0);
            avc.popoverPresentationController.permittedArrowDirections = 0;
        }

        [rootVC presentViewController:avc animated:YES completion:nil];
    });
}

// ── Security-Scoped File Reading ────────────────────────────────────────────
// Read a text file using Foundation APIs with security-scoped URL access.
// This is a fallback for when std::fs::read_to_string fails on iOS due to
// sandbox restrictions. Returns a malloc'd C string (caller must free it),
// or NULL on failure.

char* ios_read_text_file(const char* path_cstr) {
    if (!path_cstr) return NULL;

    @autoreleasepool {
        NSString *path = @(path_cstr);
        NSURL *url = [NSURL fileURLWithPath:path];

        // Try to start security-scoped access (works if the URL carries scope)
        BOOL accessing = [url startAccessingSecurityScopedResource];
        if (accessing) {
            NSLog(@"[FileHelpers] started security-scoped access for %@", path);
        }

        NSError *error = nil;
        NSString *content = [NSString stringWithContentsOfURL:url
                                                    encoding:NSUTF8StringEncoding
                                                       error:&error];

        if (accessing) {
            [url stopAccessingSecurityScopedResource];
        }

        if (error) {
            NSLog(@"[FileHelpers] read error for %@: %@", path, error);
            return NULL;
        }

        return content ? strdup(content.UTF8String) : NULL;
    }
}

// Free a string allocated by ios_read_text_file.
void ios_free_string(char* ptr) {
    free(ptr);
}

// ── Security-Scoped File Copy ──────────────────────────────────────────────
// Copy a file using Foundation APIs with security-scoped URL access.
// This is needed when the OS passes a security-scoped URL via "Open With"
// (e.g., from the Files app). Returns 1 on success, 0 on failure.

int ios_copy_file_scoped(const char* src_cstr, const char* dst_cstr) {
    if (!src_cstr || !dst_cstr) return 0;

    @autoreleasepool {
        NSString *srcPath = @(src_cstr);
        NSString *dstPath = @(dst_cstr);
        NSURL *srcURL = [NSURL fileURLWithPath:srcPath];
        NSURL *dstURL = [NSURL fileURLWithPath:dstPath];

        BOOL accessing = [srcURL startAccessingSecurityScopedResource];
        if (accessing) {
            NSLog(@"[FileHelpers] started security-scoped access for copy: %@", srcPath);
        }

        NSFileManager *fm = [NSFileManager defaultManager];

        // Remove destination if it exists (overwrite)
        [fm removeItemAtURL:dstURL error:nil];

        NSError *error = nil;
        BOOL ok = [fm copyItemAtURL:srcURL toURL:dstURL error:&error];

        if (accessing) {
            [srcURL stopAccessingSecurityScopedResource];
        }

        if (!ok) {
            NSLog(@"[FileHelpers] copy failed from %@ to %@: %@", srcPath, dstPath, error);
            return 0;
        }
        return 1;
    }
}
