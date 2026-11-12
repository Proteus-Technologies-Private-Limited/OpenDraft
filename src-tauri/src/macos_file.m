// NSSavePanel grants the selected file, not arbitrary siblings. Prefer a
// coordinated replacement; some external/network volumes require an in-place
// write with a verified recovery copy instead. Signed-volume tests are still
// required before claiming sandbox compatibility on a particular filesystem.
#import <Foundation/Foundation.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

typedef int (*PreserveOriginal)(void *, const char *, const unsigned char *, size_t);

static NSError *posixError(int code) {
    return [NSError errorWithDomain:NSPOSIXErrorDomain code:code userInfo:nil];
}

static BOOL flushFile(int fd, unsigned flags, NSError **error) {
    int result;
#ifdef OPENDRAFT_FILE_TESTING
    if (flags & 32) { errno = ENOTSUP; result = -1; }
    else
#endif
    result = fcntl(fd, F_FULLFSYNC);
    if (result != 0 && errno == ENOTSUP) result = fsync(fd);
    if (result == 0) return YES;
    *error = posixError(errno);
    return NO;
}

static BOOL matchesFile(int fd, NSData *data, NSError **error) {
    struct stat info;
    if (fstat(fd, &info) != 0) { *error = posixError(errno); return NO; }
    if (info.st_size < 0 || (unsigned long long)info.st_size != data.length) {
        *error = posixError(EIO); return NO;
    }
    unsigned char buffer[65536];
    size_t offset = 0;
    while (offset < data.length) {
        size_t amount = MIN(sizeof(buffer), data.length - offset);
        ssize_t count = pread(fd, buffer, amount, (off_t)offset);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0 || memcmp(buffer, (const unsigned char *)data.bytes + offset, (size_t)count)) {
            *error = posixError(count < 0 ? errno : EIO); return NO;
        }
        offset += (size_t)count;
    }
    return YES;
}

static BOOL writeFile(int fd, NSData *data, unsigned flags, NSError **error) {
    if (data.length > LLONG_MAX) { *error = posixError(EFBIG); return NO; }
    size_t offset = 0;
    while (offset < data.length) {
        size_t amount = MIN((size_t)1048576, data.length - offset);
#ifdef OPENDRAFT_FILE_TESTING
        if (flags & 8) amount = MIN(amount, MAX((size_t)1, data.length / 2));
#endif
        ssize_t count = pwrite(fd, (const unsigned char *)data.bytes + offset, amount, (off_t)offset);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) { *error = posixError(count < 0 ? errno : EIO); return NO; }
        offset += (size_t)count;
#ifdef OPENDRAFT_FILE_TESTING
        if (flags & 8) { *error = posixError(EIO); return NO; }
#endif
    }
    if (ftruncate(fd, (off_t)data.length) != 0) { *error = posixError(errno); return NO; }
    return flushFile(fd, flags, error) && matchesFile(fd, data, error);
}

static BOOL permissionOrCrossVolume(NSError *error) {
    // Foundation can wrap a POSIX error. Bound the walk for malformed chains.
    for (int depth = 0; error && depth < 8; depth++) {
        if ([error.domain isEqualToString:NSPOSIXErrorDomain]
            && (error.code == EPERM || error.code == EACCES || error.code == EXDEV)) return YES;
        if ([error.domain isEqualToString:NSCocoaErrorDomain]
            && error.code == NSFileWriteNoPermissionError) return YES;
        error = error.userInfo[NSUnderlyingErrorKey];
    }
    return NO;
}

static BOOL inPlace(NSURL *url, NSData *data, NSData *original, const struct stat *before,
                    PreserveOriginal preserve, void *context, unsigned flags,
                    const char **stage, NSError **error) {
    *error = nil;
    *stage = "backup";
    if (original && (!preserve || !preserve(context, url.fileSystemRepresentation,
                                          original.bytes, original.length))) {
        *error = [NSError errorWithDomain:NSCocoaErrorDomain code:NSFileWriteUnknownError
                                userInfo:@{NSLocalizedDescriptionKey: @"Could not preserve the original file"}];
        return NO;
    }
    *stage = "replacement";
    // Open without truncating. Do not overwrite a newly appeared file or follow
    // a symlink swapped in after the coordinator supplied its destination.
    int options = O_RDWR | O_NOFOLLOW | (original ? 0 : O_CREAT | O_EXCL);
    int fd = open(url.fileSystemRepresentation, options, 0600);
    if (fd < 0) { *error = posixError(errno); return NO; }
    struct stat opened = {0};
    BOOL success = NO;
    @try {
        if (fstat(fd, &opened) != 0) { *error = posixError(errno); return NO; }
        if (!S_ISREG(opened.st_mode)) { *error = posixError(EINVAL); return NO; }
        if (original && (opened.st_dev != before->st_dev || opened.st_ino != before->st_ino
                         || !matchesFile(fd, original, error))) {
            if (!*error) *error = posixError(EBUSY);
            return NO;
        }
        success = writeFile(fd, data, flags, error);
        if (!success && original) {
            NSError *restoreError = nil;
            BOOL restored;
#ifdef OPENDRAFT_FILE_TESTING
            if (flags & 16) { restoreError = posixError(EIO); restored = NO; }
            else
#endif
            restored = writeFile(fd, original, 0, &restoreError);
            if (!restored) {
                *error = [NSError errorWithDomain:NSCocoaErrorDomain code:NSFileWriteUnknownError
                    userInfo:@{NSLocalizedDescriptionKey: @"Save and restoration failed. Recover the preserved original with File > Recover Original File.",
                               NSUnderlyingErrorKey: restoreError ?: posixError(EIO)}];
            }
        }
    } @finally {
        close(fd);
        // Only remove a new partial file if the directory entry still names
        // the inode we created, never an unrelated file that replaced it.
        if (!success && !original) {
            struct stat current;
            if (lstat(url.fileSystemRepresentation, &current) == 0
                && current.st_dev == opened.st_dev && current.st_ino == opened.st_ino) {
                unlink(url.fileSystemRepresentation);
            }
        }
    }
    return success;
}

static int replaceImpl(const char *path, const unsigned char *bytes, size_t length,
                       PreserveOriginal preserve, void *context, unsigned flags,
                       char **error_message) {
    @autoreleasepool {
        if (error_message) *error_message = NULL;
        __block BOOL success = NO;
        __block NSError *writeError = nil;
        __block const char *stage = "destination";
        __block NSURL *directory = nil;
        NSURL *url = nil;
        BOOL accessing = NO;
        @try {
#ifdef OPENDRAFT_FILE_TESTING
            if (flags & 4) [NSException raise:@"InjectedFileException" format:@"Injected Foundation failure"];
#endif
            if (!path || (length && !bytes)) {
                writeError = posixError(EINVAL);
            } else {
                NSString *name = [[NSFileManager defaultManager]
                    stringWithFileSystemRepresentation:path length:strlen(path)];
                url = [NSURL fileURLWithPath:name];
                accessing = [url startAccessingSecurityScopedResource];
                NSData *data = [NSData dataWithBytes:bytes length:length];
                NSError *coordinationError = nil;
                NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
                [coordinator coordinateWritingItemAtURL:url
                    options:NSFileCoordinatorWritingForReplacing error:&coordinationError
                    byAccessor:^(NSURL *destination) {
#ifdef OPENDRAFT_FILE_TESTING
                    if (flags & 256) [NSException raise:@"InjectedFileException" format:@"Injected Foundation failure"];
#endif
                    struct stat before = {0};
                    BOOL exists = stat(destination.fileSystemRepresentation, &before) == 0;
                    if (!exists && errno != ENOENT) { writeError = posixError(errno); return; }
                    if (exists && !S_ISREG(before.st_mode)) { writeError = posixError(EISDIR); return; }
                    NSData *original = exists ? [NSData dataWithContentsOfURL:destination options:0 error:&writeError] : nil;
                    if (exists && !original) return;
                    // Replacing one hard-linked name would sever its identity.
                    if (exists && before.st_nlink > 1) {
                        success = inPlace(destination, data, original, &before, preserve, context, flags, &stage, &writeError);
                        return;
                    }
                    NSFileManager *manager = [NSFileManager defaultManager];
                    stage = "staging";
#ifdef OPENDRAFT_FILE_TESTING
                    if (flags & 1) writeError = posixError(EPERM);
                    else
#endif
                    directory = [manager URLForDirectory:NSItemReplacementDirectory inDomain:NSUserDomainMask
                        appropriateForURL:destination create:YES error:&writeError];
                    if (!directory) {
                        success = inPlace(destination, data, original, &before, preserve, context, flags, &stage, &writeError);
                        return;
                    }
                    struct stat stagingInfo, volumeInfo;
                    NSURL *volume = exists ? destination : destination.URLByDeletingLastPathComponent;
                    BOOL sameVolume = stat(directory.fileSystemRepresentation, &stagingInfo) == 0
                        && stat(volume.fileSystemRepresentation, &volumeInfo) == 0
                        && stagingInfo.st_dev == volumeInfo.st_dev;
#ifdef OPENDRAFT_FILE_TESTING
                    if (flags & 64) sameVolume = NO;
#endif
                    if (!sameVolume) {
                        success = inPlace(destination, data, original, &before, preserve, context, flags, &stage, &writeError);
                        return;
                    }
                    NSURL *staged = [directory URLByAppendingPathComponent:@"replacement"];
                    if (![data writeToURL:staged options:NSDataWritingWithoutOverwriting error:&writeError]) return;
                    int fd = open(staged.fileSystemRepresentation, O_RDWR);
                    if (fd < 0) { writeError = posixError(errno); return; }
                    BOOL verified = flushFile(fd, flags, &writeError) && matchesFile(fd, data, &writeError);
                    close(fd);
                    if (!verified) return;
                    stage = "replacement";
#ifdef OPENDRAFT_FILE_TESTING
                    if (flags & (2 | 128)) writeError = posixError((flags & 128) ? EXDEV : EPERM);
                    else
#endif
                    if (exists) {
                        success = [manager replaceItemAtURL:destination withItemAtURL:staged backupItemName:nil
                            options:0 resultingItemURL:NULL error:&writeError];
                    } else {
                        success = [manager moveItemAtURL:staged toURL:destination error:&writeError];
                    }
                    if (!success && permissionOrCrossVolume(writeError)) {
                        success = inPlace(destination, data, original, &before, preserve, context, flags, &stage, &writeError);
                    }
                }];
                if (coordinationError) { stage = "destination"; writeError = coordinationError; success = NO; }
            }
        } @catch (NSException *exception) {
            success = NO;
            writeError = [NSError errorWithDomain:NSCocoaErrorDomain code:NSFileWriteUnknownError
                userInfo:@{NSLocalizedDescriptionKey: exception.reason ?: @"macOS file operation failed"}];
        } @finally {
            // Neither cleanup nor scope release may unwind through the Rust FFI.
            @try {
                if (directory) [[NSFileManager defaultManager] removeItemAtURL:directory error:NULL];
            } @catch (NSException *exception) {
                NSLog(@"[FileSave] Staging cleanup failed: %@", exception.reason);
            }
            @try {
                if (accessing) [url stopAccessingSecurityScopedResource];
            } @catch (NSException *exception) {
                NSLog(@"[FileSave] Scope release failed: %@", exception.reason);
            }
        }
        if (!success && error_message) {
            NSString *detail = writeError.localizedDescription ?: @"macOS file replacement failed";
            *error_message = strdup([NSString stringWithFormat:@"Save failed during %s: %@", stage, detail].UTF8String);
        }
        return success ? 1 : 0;
    }
}

int opendraft_macos_replace(const char *path, const unsigned char *bytes, size_t length,
                           PreserveOriginal preserve, void *context, char **error_message) {
    return replaceImpl(path, bytes, length, preserve, context, 0, error_message);
}

#ifdef OPENDRAFT_FILE_TESTING
int opendraft_macos_replace_for_test(const char *path, const unsigned char *bytes, size_t length,
                                    PreserveOriginal preserve, void *context, unsigned flags, char **error_message) {
    return replaceImpl(path, bytes, length, preserve, context, flags, error_message);
}
#endif

void opendraft_macos_free_error(char *message) { free(message); }
