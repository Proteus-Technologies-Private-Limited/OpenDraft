#import <UIKit/UIKit.h>
#import <Foundation/Foundation.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <objc/runtime.h>

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

// ── Security-Scoped Binary File Reading ─────────────────────────────────────
// The archive counterpart of ios_read_text_file, for the screenplay formats
// that are zip containers rather than text — .fadein above all (issue #64).
//
// Two reasons it cannot go through the text path: decoding an archive as UTF-8
// destroys it, and plain std::fs::read fails outright on a file the app only
// holds a security-scoped grant to — which is exactly what the Files app hands
// over with "Open in OpenDraft". The text reader has had this fallback all
// along; its binary counterpart did not, so a .fadein could fail where a
// .fountain from the same folder succeeded.
//
// Returns a malloc'd buffer the caller owns (free it with ios_free_bytes) and
// writes its length to out_len. NULL on failure.

unsigned char* ios_read_binary_file(const char* path_cstr, size_t* out_len) {
    if (!path_cstr || !out_len) return NULL;
    *out_len = 0;

    @autoreleasepool {
        NSString *path = @(path_cstr);
        NSURL *url = [NSURL fileURLWithPath:path];

        BOOL accessing = [url startAccessingSecurityScopedResource];
        if (accessing) {
            NSLog(@"[FileHelpers] started security-scoped access for binary read: %@", path);
        }

        // Coordinated, like the in-place reader: a document that lives in
        // Dropbox or iCloud may still need materializing before there are any
        // bytes to read.
        __block NSData *data = nil;
        __block NSError *readError = nil;
        NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
        NSError *coordError = nil;
        [coordinator coordinateReadingItemAtURL:url
                                        options:0
                                          error:&coordError
                                     byAccessor:^(NSURL *newURL) {
            data = [NSData dataWithContentsOfURL:newURL options:0 error:&readError];
        }];

        if (accessing) {
            [url stopAccessingSecurityScopedResource];
        }

        if (coordError) {
            NSLog(@"[FileHelpers] binary read coordination failed for %@: %@", path, coordError);
            return NULL;
        }
        if (!data) {
            NSLog(@"[FileHelpers] binary read failed for %@: %@", path, readError);
            return NULL;
        }
        // An empty file is not something any importer can use, and malloc(0)
        // may hand back NULL — which the caller reads as failure anyway. Say so
        // here rather than let it look like a permissions problem.
        if (data.length == 0) {
            NSLog(@"[FileHelpers] binary read got 0 bytes for %@", path);
            return NULL;
        }

        unsigned char *buffer = malloc(data.length);
        if (!buffer) {
            NSLog(@"[FileHelpers] could not allocate %lu bytes for %@",
                  (unsigned long)data.length, path);
            return NULL;
        }
        [data getBytes:buffer length:data.length];
        *out_len = data.length;
        return buffer;
    }
}

// Free a buffer allocated by ios_read_binary_file.
void ios_free_bytes(unsigned char* ptr) {
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

// ── Open In Place ───────────────────────────────────────────────────────────
// Editing a screenplay that lives in Files or Dropbox, rather than importing a
// copy of it (issue #62).
//
// The picker runs with asCopy:NO, so the URL it returns is security-scoped and
// points at the real document in its provider.  A bookmark is taken from that
// URL immediately and handed to the frontend as the document's identity —
// bookmarks are the only thing that survives a relaunch, since the URL itself
// carries a scope grant that does not.
//
// The picker is presented asynchronously and its result arrives on a delegate,
// so the result is parked in a static and polled for, the same shape the
// Android document picker already uses.

// nil while a pick is in flight; @"" when the user cancelled; otherwise
// "<base64 bookmark>\n<filename>".
//
// Written on the main queue by the delegate and read from the thread Tauri
// runs commands on, so every access is synchronized: under ARC an unguarded
// strong-reference swap racing with a read can release the string while the
// reader is retaining it.
static NSString *gPickedDocument = nil;
static BOOL gPickPending = NO;

/// The monitor guarding the two statics above.  Created once, before any
/// caller can reach it — `@synchronized(nil)` is silently no-op, so a lazily
/// initialized lock would leave the first access unguarded.
static id od_pick_lock(void) {
    static id lock = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ lock = [[NSObject alloc] init]; });
    return lock;
}

/// Publish a pick outcome. Pass nil to arm a new pick.
static void od_set_pick_result(NSString *result, BOOL pending) {
    @synchronized (od_pick_lock()) {
        gPickedDocument = [result copy];
        gPickPending = pending;
    }
}

@interface ODDocumentPickerDelegate : NSObject <UIDocumentPickerDelegate>
@end

@implementation ODDocumentPickerDelegate

- (void)documentPicker:(UIDocumentPickerViewController *)controller
    didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
    NSURL *url = urls.firstObject;
    if (!url) {
        od_set_pick_result(@"", NO);
        return;
    }

    // The bookmark has to be created while the scope is held, or it resolves to
    // a URL the app is not allowed to read.
    BOOL accessing = [url startAccessingSecurityScopedResource];
    NSError *error = nil;
    NSData *bookmark = [url bookmarkDataWithOptions:0
                     includingResourceValuesForKeys:nil
                                      relativeToURL:nil
                                              error:&error];
    if (accessing) {
        [url stopAccessingSecurityScopedResource];
    }

    if (!bookmark) {
        NSLog(@"[FileHelpers] could not bookmark %@: %@", url, error);
        od_set_pick_result(@"", NO);
        return;
    }

    NSString *encoded = [bookmark base64EncodedStringWithOptions:0];
    od_set_pick_result(
        [NSString stringWithFormat:@"%@\n%@", encoded, url.lastPathComponent], NO);
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
    od_set_pick_result(@"", NO);
}

@end

// Retained for as long as the picker is on screen — UIDocumentPickerViewController
// holds its delegate weakly.
static ODDocumentPickerDelegate *gPickerDelegate = nil;

/// Present the system document picker.  Returns immediately; poll
/// ios_get_picked_document() for the result.
void ios_pick_document(void) {
    od_set_pick_result(nil, YES);

    dispatch_async(dispatch_get_main_queue(), ^{
        // Deliberately UTTypeItem rather than the screenplay types: iOS filters
        // the picker by declared UTI, and .fdx/.fountain have no system type,
        // so a narrower list hides exactly the files this is for.
        UIDocumentPickerViewController *picker =
            [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:@[UTTypeItem]
                                                                       asCopy:NO];

        if (!gPickerDelegate) {
            gPickerDelegate = [[ODDocumentPickerDelegate alloc] init];
        }
        picker.delegate = gPickerDelegate;
        picker.allowsMultipleSelection = NO;

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
            NSLog(@"[FileHelpers] document picker: no root view controller found");
            od_set_pick_result(@"", NO);
            return;
        }
        while (rootVC.presentedViewController) {
            rootVC = rootVC.presentedViewController;
        }

        [rootVC presentViewController:picker animated:YES completion:nil];
    });
}

/// NULL while the picker is still open, "" when cancelled, otherwise
/// "<base64 bookmark>\n<filename>".  Caller frees with ios_free_string.
char* ios_get_picked_document(void) {
    @synchronized (od_pick_lock()) {
        if (gPickPending || gPickedDocument == nil) return NULL;
        return strdup(gPickedDocument.UTF8String);
    }
}

/// Resolve a bookmark, refreshing it when the provider has moved the file.
/// Returns nil on failure; `outURL` is scoped and must be released by the
/// caller via stopAccessingSecurityScopedResource.
static NSURL* od_resolve_bookmark(NSString *encoded, BOOL *outAccessing) {
    NSData *data = [[NSData alloc] initWithBase64EncodedString:encoded options:0];
    if (!data) {
        NSLog(@"[FileHelpers] bookmark is not valid base64");
        return nil;
    }

    BOOL stale = NO;
    NSError *error = nil;
    NSURL *url = [NSURL URLByResolvingBookmarkData:data
                                           options:NSURLBookmarkResolutionWithoutUI
                                     relativeToURL:nil
                               bookmarkDataIsStale:&stale
                                             error:&error];
    if (!url) {
        NSLog(@"[FileHelpers] could not resolve bookmark: %@", error);
        return nil;
    }
    if (stale) {
        // Not fatal — a stale bookmark still resolves.  The frontend is not
        // told to refresh it, so this is logged rather than silently ignored.
        NSLog(@"[FileHelpers] bookmark for %@ is stale", url.lastPathComponent);
    }

    *outAccessing = [url startAccessingSecurityScopedResource];
    return url;
}

/// Read a bookmarked text file.  Returns a malloc'd C string, or NULL.
char* ios_read_bookmarked_file(const char* bookmark_cstr) {
    if (!bookmark_cstr) return NULL;

    @autoreleasepool {
        BOOL accessing = NO;
        NSURL *url = od_resolve_bookmark(@(bookmark_cstr), &accessing);
        if (!url) return NULL;

        // Through a coordinator so a provider like Dropbox can materialize the
        // file (and finish any download) before the read.
        __block NSString *content = nil;
        __block NSError *readError = nil;
        NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
        NSError *coordError = nil;
        [coordinator coordinateReadingItemAtURL:url
                                        options:0
                                          error:&coordError
                                     byAccessor:^(NSURL *newURL) {
            content = [NSString stringWithContentsOfURL:newURL
                                               encoding:NSUTF8StringEncoding
                                                  error:&readError];
        }];

        if (accessing) {
            [url stopAccessingSecurityScopedResource];
        }

        if (coordError) {
            NSLog(@"[FileHelpers] read coordination failed for %@: %@", url, coordError);
            return NULL;
        }
        if (!content) {
            NSLog(@"[FileHelpers] read failed for %@: %@", url, readError);
            return NULL;
        }
        return strdup(content.UTF8String);
    }
}

/// Read a bookmarked file as raw bytes.
///
/// The archive counterpart of ios_read_bookmarked_file, for the formats that
/// are containers rather than text — a .fadein is a zip, and reading one
/// through a UTF-8 decoder returns nothing at all, which is what made picking
/// one report that the file had been moved or deleted.
///
/// Returns a malloc'd buffer the caller owns (free with ios_free_bytes) and
/// writes its length to out_len.  NULL on failure.
unsigned char* ios_read_bookmarked_bytes(const char* bookmark_cstr, size_t* out_len) {
    if (!bookmark_cstr || !out_len) return NULL;
    *out_len = 0;

    @autoreleasepool {
        BOOL accessing = NO;
        NSURL *url = od_resolve_bookmark(@(bookmark_cstr), &accessing);
        if (!url) return NULL;

        __block NSData *data = nil;
        __block NSError *readError = nil;
        NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
        NSError *coordError = nil;
        [coordinator coordinateReadingItemAtURL:url
                                        options:0
                                          error:&coordError
                                     byAccessor:^(NSURL *newURL) {
            data = [NSData dataWithContentsOfURL:newURL options:0 error:&readError];
        }];

        if (accessing) {
            [url stopAccessingSecurityScopedResource];
        }

        if (coordError) {
            NSLog(@"[FileHelpers] byte read coordination failed for %@: %@", url, coordError);
            return NULL;
        }
        if (!data || data.length == 0) {
            NSLog(@"[FileHelpers] byte read failed for %@: %@", url, readError);
            return NULL;
        }

        unsigned char *buffer = malloc(data.length);
        if (!buffer) return NULL;
        [data getBytes:buffer length:data.length];
        *out_len = data.length;
        return buffer;
    }
}

/// Write raw bytes back over a bookmarked file.  Returns 1 on success.
int ios_write_bookmarked_bytes(const char* bookmark_cstr,
                               const unsigned char* bytes,
                               size_t length) {
    if (!bookmark_cstr || (!bytes && length > 0)) return 0;

    @autoreleasepool {
        BOOL accessing = NO;
        NSURL *url = od_resolve_bookmark(@(bookmark_cstr), &accessing);
        if (!url) return 0;

        NSData *data = [NSData dataWithBytes:bytes length:length];
        __block BOOL ok = NO;
        __block NSError *writeError = nil;
        NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
        NSError *coordError = nil;
        [coordinator coordinateWritingItemAtURL:url
                                        options:NSFileCoordinatorWritingForReplacing
                                          error:&coordError
                                     byAccessor:^(NSURL *newURL) {
            ok = [data writeToURL:newURL options:NSDataWritingAtomic error:&writeError];
        }];

        if (accessing) {
            [url stopAccessingSecurityScopedResource];
        }

        if (coordError) {
            NSLog(@"[FileHelpers] byte write coordination failed for %@: %@", url, coordError);
            return 0;
        }
        if (!ok) {
            NSLog(@"[FileHelpers] byte write failed for %@: %@", url, writeError);
            return 0;
        }
        return 1;
    }
}

/// Write a bookmarked text file in place.  Returns 1 on success, 0 on failure.
int ios_write_bookmarked_file(const char* bookmark_cstr, const char* contents_cstr) {
    if (!bookmark_cstr || !contents_cstr) return 0;

    @autoreleasepool {
        BOOL accessing = NO;
        NSURL *url = od_resolve_bookmark(@(bookmark_cstr), &accessing);
        if (!url) return 0;

        NSString *contents = @(contents_cstr);
        __block BOOL ok = NO;
        __block NSError *writeError = nil;
        NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
        NSError *coordError = nil;
        // ForReplacing is the option that pairs with an atomic write: it tells
        // the provider the file is being swapped rather than appended to, so
        // Dropbox uploads the new contents instead of seeing a delete.
        [coordinator coordinateWritingItemAtURL:url
                                        options:NSFileCoordinatorWritingForReplacing
                                          error:&coordError
                                     byAccessor:^(NSURL *newURL) {
            ok = [contents writeToURL:newURL
                           atomically:YES
                             encoding:NSUTF8StringEncoding
                                error:&writeError];
        }];

        if (accessing) {
            [url stopAccessingSecurityScopedResource];
        }

        if (coordError) {
            NSLog(@"[FileHelpers] write coordination failed for %@: %@", url, coordError);
            return 0;
        }
        if (!ok) {
            NSLog(@"[FileHelpers] write failed for %@: %@", url, writeError);
            return 0;
        }
        return 1;
    }
}

// ── Cold-launch file association under scenes ───────────────────────────────
// Multiple windows on iPad (issue #63) requires a UIApplicationSceneManifest,
// and declaring one changes how the system hands a tapped file to the app:
// UIKit stops calling application:openURL:options: and puts the URL in the
// scene's connection options instead.
//
// tao forwards those options only for scenes it did not create itself, which
// excludes the very first one — so with the manifest and nothing else, tapping
// a screenplay in Files while OpenDraft was closed would launch the app into a
// blank editor.  That is a worse regression than multi-window is a feature, so
// the launch URL is captured here instead.
//
// The interception point is application:configurationForConnectingSceneSession:
// options:, which UIKit calls for every scene including the first, and which
// receives the same UISceneConnectionOptions the scene delegate would get.
// It is installed by way of -[UIApplication setDelegate:] because tao's app
// delegate class does not exist until its event loop is built, which is after
// +load and before UIApplicationMain assigns the delegate — setDelegate: is the
// one moment that is reliably in between.
//
// Everything here degrades to nothing: if the delegate turns out not to
// implement the scene method (no manifest, so no multi-window), the hook logs
// and leaves the app on the application:openURL:options: path it uses today.

/// Path of the staged copy of a file the app was launched with, or nil.
/// Read once, by ios_take_launch_file.
static NSString *gSceneLaunchFile = nil;

/// Guards gSceneLaunchFile.  Written on the main thread during launch and read
/// from whichever thread Tauri runs commands on.
static id od_launch_lock(void) {
    static id lock = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ lock = [[NSObject alloc] init]; });
    return lock;
}

/// Copy a security-scoped URL into the sandbox, returning the copy's path.
///
/// The URL is only readable while the scope grant is held, and the grant dies
/// with the launch, so the bytes have to be taken now rather than when the
/// frontend gets around to asking for them.
static NSString* od_stage_launch_url(NSURL *url) {
    NSString *name = url.lastPathComponent;
    if (name.length == 0) return nil;

    NSString *dest = [NSTemporaryDirectory() stringByAppendingPathComponent:name];
    if (ios_copy_file_scoped(url.path.UTF8String, dest.UTF8String) == 1) {
        return dest;
    }
    // Not fatal on its own: a file already inside the sandbox (the Inbox copy
    // another app hands over) can be read where it lies.
    if ([[NSFileManager defaultManager] isReadableFileAtPath:url.path]) {
        return url.path;
    }
    return nil;
}

static void od_capture_launch_urls(UISceneConnectionOptions *options) {
    // Belt and braces on the way into a launch path: this runs before the app
    // has a window, so anything unexpected here is a crash on start rather
    // than a bug someone can work around.
    if (!options || ![options isKindOfClass:[UISceneConnectionOptions class]]) return;
    for (UIOpenURLContext *ctx in options.URLContexts) {
        NSURL *url = ctx.URL;
        if (!url.isFileURL) continue;
        NSString *staged = od_stage_launch_url(url);
        if (!staged) {
            NSLog(@"[FileHelpers] could not stage launch file %@", url);
            continue;
        }
        @synchronized (od_launch_lock()) {
            gSceneLaunchFile = [staged copy];
        }
        NSLog(@"[FileHelpers] captured launch file: %@", staged);
        return;  // one document per launch; OpenDraft opens one at a time
    }
}

/// Hand the captured launch file to Rust.  Returns a malloc'd C string the
/// caller owns, or NULL when there is nothing waiting.  Reading consumes it, so
/// a second window cannot reopen the document the first one already has.
char* ios_take_launch_file(void) {
    @autoreleasepool {
        NSString *path = nil;
        @synchronized (od_launch_lock()) {
            path = gSceneLaunchFile;
            gSceneLaunchFile = nil;
        }
        return path ? strdup(path.UTF8String) : NULL;
    }
}

// ── Startup's leftover scene ────────────────────────────────────────────────
// Creating the main window is itself enough to make tao ask the system for a
// scene: it looks for a connected scene with no window in it, and during the
// very first scene's connection there is not one yet. The window it was asking
// on behalf of then gets attached to the scene that was already connecting, and
// the scene the system goes on to create arrives with nothing to show — as a
// second, empty OpenDraft window sitting beside the real one on every launch.
//
// Nothing can un-ask for it, so it is dismissed once it turns up.

/// Ask the system to close a connected window scene that holds no window.
///
/// Never touches the last scene: if something has gone wrong and the app's only
/// scene is the empty one, a blank window is a great deal better than no window
/// at all. Deferred to the next turn of the run loop because it is called from
/// inside scene connection, which is no time to be tearing scenes down.
void ios_discard_empty_scene(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            UIApplication *app = UIApplication.sharedApplication;

            NSMutableArray<UIWindowScene *> *windowScenes = [NSMutableArray array];
            for (UIScene *scene in app.connectedScenes) {
                if ([scene isKindOfClass:[UIWindowScene class]]) {
                    [windowScenes addObject:(UIWindowScene *)scene];
                }
            }
            if (windowScenes.count < 2) return;

            for (UIWindowScene *scene in windowScenes) {
                if (scene.windows.count > 0) continue;

                NSLog(@"[FileHelpers] discarding the empty scene left over from startup");
                UIWindowSceneDestructionRequestOptions *options =
                    [[UIWindowSceneDestructionRequestOptions alloc] init];
                options.windowDismissalAnimation = UIWindowSceneDismissalAnimationStandard;
                [app requestSceneSessionDestruction:scene.session
                                            options:options
                                       errorHandler:^(NSError *error) {
                    NSLog(@"[FileHelpers] could not discard the empty scene: %@", error);
                }];
                return;  // one per launch; anything further is a real window
            }
        }
    });
}

/// Bring another of the app's windows to the front.
///
/// Used when a screenplay turns out to be open in a second window: switching to
/// the window that has it is the answer, not editing a copy that would save
/// over the original.
///
/// Which window is not something Rust can say here. A Tauri window knows its
/// label, and its UIScene knows its identifier, but the API that maps one to
/// the other is behind tauri's `unstable` feature — which also changes how the
/// webview is attached to the window, and that is not worth trading for a
/// convenience. So the scene is chosen the only way it can be from here: the
/// one that is not the window the writer is looking at. With the two windows
/// this prompt is about, that is exactly the right one.
///
/// iPadOS decides where the scene actually lands — full screen, or beside the
/// current one — so this is a request, not a command.
/// The identifiers of every connected window scene, comma-separated.
///
/// Rust keeps a label → scene map so it can tell which of its windows still
/// exist: tao's scene delegate ignores sceneDidDisconnect, so a window closed
/// with the iPadOS window control stays in Tauri's list forever. A window whose
/// scene is not in this list is a ghost.
///
/// Returns a malloc'd C string the caller owns, or NULL when there are none.
char* ios_connected_scene_ids(void) {
    __block char *result = NULL;

    void (^collect)(void) = ^{
        @autoreleasepool {
            NSMutableArray<NSString *> *ids = [NSMutableArray array];
            for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
                if (![scene isKindOfClass:[UIWindowScene class]]) continue;
                NSString *identifier = scene.session.persistentIdentifier;
                if (identifier.length > 0) [ids addObject:identifier];
            }
            if (ids.count == 0) return;
            result = strdup([ids componentsJoinedByString:@","].UTF8String);
        }
    };

    if (NSThread.isMainThread) {
        collect();
    } else {
        dispatch_sync(dispatch_get_main_queue(), collect);
    }
    return result;
}

/// The scene showing the window the writer is looking at, or NULL.
char* ios_key_scene_id(void) {
    __block char *result = NULL;

    void (^find)(void) = ^{
        @autoreleasepool {
            for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
                if (![scene isKindOfClass:[UIWindowScene class]]) continue;
                for (UIWindow *window in ((UIWindowScene *)scene).windows) {
                    if (!window.isKeyWindow) continue;
                    NSString *identifier = scene.session.persistentIdentifier;
                    if (identifier.length > 0) result = strdup(identifier.UTF8String);
                    return;
                }
            }
        }
    };

    if (NSThread.isMainThread) {
        find();
    } else {
        dispatch_sync(dispatch_get_main_queue(), find);
    }
    return result;
}

/// Bring a particular scene to the front. Returns 1 when it was found.
int ios_activate_scene_id(const char* identifier_cstr) {
    if (!identifier_cstr) return 0;
    NSString *identifier = @(identifier_cstr);
    __block int found = 0;

    void (^activate)(void) = ^{
        @autoreleasepool {
            UIApplication *app = UIApplication.sharedApplication;
            for (UIScene *scene in app.connectedScenes) {
                if (![scene.session.persistentIdentifier isEqualToString:identifier]) continue;
                found = 1;
                [app requestSceneSessionActivation:scene.session
                                      userActivity:nil
                                           options:nil
                                      errorHandler:^(NSError *error) {
                    NSLog(@"[FileHelpers] could not activate scene %@: %@", identifier, error);
                }];
                return;
            }
        }
    };

    if (NSThread.isMainThread) {
        activate();
    } else {
        dispatch_sync(dispatch_get_main_queue(), activate);
    }
    return found;
}

int ios_activate_other_scene(void) {
    __block int found = 0;

    // Synchronously on the main thread: the caller reports back to the writer,
    // so "there was no other window" has to be an answer, not a log line.
    void (^activate)(void) = ^{
        @autoreleasepool {
            UIApplication *app = UIApplication.sharedApplication;

            // The window the writer is looking at is the key one. Activation
            // state is no use for telling the two apart — side by side on an
            // iPad, both scenes are foreground-active.
            UIWindowScene *current = nil;
            for (UIScene *scene in app.connectedScenes) {
                if (![scene isKindOfClass:[UIWindowScene class]]) continue;
                for (UIWindow *window in ((UIWindowScene *)scene).windows) {
                    if (window.isKeyWindow) {
                        current = (UIWindowScene *)scene;
                        break;
                    }
                }
                if (current) break;
            }

            UIWindowScene *candidate = nil;
            for (UIScene *scene in app.connectedScenes) {
                if (![scene isKindOfClass:[UIWindowScene class]]) continue;
                UIWindowScene *windowScene = (UIWindowScene *)scene;
                if (windowScene == current) continue;
                // A scene with no window of its own has nothing to show.
                if (windowScene.windows.count == 0) continue;
                candidate = windowScene;
                break;
            }
            if (!candidate) {
                NSLog(@"[FileHelpers] no other scene to switch to");
                return;
            }

            found = 1;
            [app requestSceneSessionActivation:candidate.session
                                  userActivity:nil
                                       options:nil
                                  errorHandler:^(NSError *error) {
                NSLog(@"[FileHelpers] could not activate the other scene: %@", error);
            }];
        }
    };

    if (NSThread.isMainThread) {
        activate();
    } else {
        dispatch_sync(dispatch_get_main_queue(), activate);
    }
    return found;
}

// Both hooks below are installed by exchanging implementations rather than by
// keeping the original IMP and calling it through a cast function pointer. Two
// reasons, and the first one crashed the app on a real device:
//
//   1. The scene configuration method's return value must not be touched by
//      ARC. tao builds the UISceneConfiguration from a `Retained` and returns a
//      raw pointer to it, then drops the `Retained` on the way out — so what
//      comes back has already been released. UIKit gets away with it; a hook
//      that returns it as `id` does not, because ARC retains it on the way
//      through and faults on freed memory. It is passed along as an opaque
//      `void *` for that reason: no retain, no release, nothing but a handoff.
//
//   2. Calling a raw IMP through a cast function pointer is unsound on arm64e,
//      where pointer authentication signs function pointers by type. An
//      ordinary message send to the exchanged selector goes through the runtime
//      and is correct everywhere.

/// Carrier for the replacement implementations. They are never called on an
/// instance of this class — each is copied onto the class being hooked, where
/// `self` is that class's instance.
@interface ODSceneHooks : NSObject
- (void *)od_application:(__unsafe_unretained id)application
    configurationForConnectingSceneSession:(__unsafe_unretained id)session
                                   options:(__unsafe_unretained UISceneConnectionOptions *)options;
@end

@implementation ODSceneHooks

- (void *)od_application:(__unsafe_unretained id)application
    configurationForConnectingSceneSession:(__unsafe_unretained UISceneSession *)session
                                   options:(__unsafe_unretained UISceneConnectionOptions *)options {
    od_capture_launch_urls(options);

    // Call the original for its side effect only, and throw its answer away.
    //
    // tao builds the configuration from an objc2 `Retained` and returns a raw
    // pointer to it, dropping the `Retained` — and so releasing the object — on
    // the way out. What comes back has already been deallocated, and UIKit
    // retains the configuration it is given: on an iPad that is an immediate
    // EXC_BAD_ACCESS in -[UIApplication _connectUISceneFromFBSScene:], on every
    // launch. (The simulator survived it, which is exactly the kind of thing
    // only a device build tells you.)
    //
    // The call still matters: it is what registers the TaoSceneDelegate class,
    // and the scene is inert without that delegate. So tao runs, its dangling
    // pointer is discarded untouched, and an equivalent configuration — one
    // that is still alive — is handed to UIKit instead.
    (void)[self od_application:application
        configurationForConnectingSceneSession:session
                                       options:options];

    Class delegateClass = NSClassFromString(@"TaoSceneDelegate");
    if (!delegateClass) {
        NSLog(@"[FileHelpers] TaoSceneDelegate is not registered; the scene will "
              @"have no delegate and no window will attach to it");
    }

    // Unnamed on purpose: a name only matters for looking up a configuration in
    // the Info.plist, and this one is built here. Naming it would just make
    // UIKit log a complaint about the missing plist entry on every launch.
    UISceneConfiguration *configuration =
        [UISceneConfiguration configurationWithName:nil sessionRole:session.role];
    configuration.delegateClass = delegateClass;

    // Explicitly +1-then-autoreleased rather than a plain bridge cast. ARC is
    // entitled to claim an autoreleased return value into the local and release
    // it at the end of this scope — which is precisely how tao's configuration
    // came to be freed before UIKit ever saw it. Handing it to the pool means
    // it is alive when this returns, whatever the optimizer decides.
    return (void *)CFAutorelease(CFBridgingRetain(configuration));
}

@end

static void od_install_scene_config_hook(Class delegateClass) {
    static BOOL installed = NO;
    if (installed || !delegateClass) return;

    SEL originalSel = @selector(application:configurationForConnectingSceneSession:options:);
    SEL hookSel = @selector(od_application:configurationForConnectingSceneSession:options:);

    Method original = class_getInstanceMethod(delegateClass, originalSel);
    if (!original) {
        // Expected whenever multiple scenes are not enabled — the app delegate
        // only grows this method when the Info.plist manifest is present.
        NSLog(@"[FileHelpers] %@ does not handle scene configuration; "
              @"leaving file association on the openURL path",
              NSStringFromClass(delegateClass));
        return;
    }

    Method hook = class_getInstanceMethod([ODSceneHooks class], hookSel);
    if (!hook) return;

    if (!class_addMethod(delegateClass, hookSel,
                         method_getImplementation(hook),
                         method_getTypeEncoding(hook))) {
        NSLog(@"[FileHelpers] could not add the scene hook to %@",
              NSStringFromClass(delegateClass));
        return;
    }

    Method added = class_getInstanceMethod(delegateClass, hookSel);
    if (!added) return;

    method_exchangeImplementations(original, added);
    installed = YES;
    NSLog(@"[FileHelpers] scene launch hook installed on %@", NSStringFromClass(delegateClass));
}

/// Installs the hook above at the one moment it can be: tao's app delegate
/// class does not exist until its event loop is built, which is after +load and
/// before UIApplicationMain hands the delegate to the application.
@interface UIApplication (ODSceneLaunchHook)
@end

@implementation UIApplication (ODSceneLaunchHook)

- (void)od_setDelegate:(__unsafe_unretained id)delegate {
    if (delegate) {
        od_install_scene_config_hook([delegate class]);
    }
    [self od_setDelegate:delegate];  // the original, after the exchange
}

+ (void)load {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        Method original = class_getInstanceMethod(self, @selector(setDelegate:));
        Method hook = class_getInstanceMethod(self, @selector(od_setDelegate:));
        if (!original || !hook) {
            NSLog(@"[FileHelpers] could not hook setDelegate:; "
                  @"cold-start file association will use the openURL path");
            return;
        }
        method_exchangeImplementations(original, hook);
    });
}

@end
