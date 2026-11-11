// NSSavePanel grants access to the selected file, not arbitrary siblings.
// Coordinate replacement and ask Foundation for its permitted staging folder.
#import <Foundation/Foundation.h>
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int opendraft_macos_replace(const char *path, const unsigned char *bytes,
                           size_t length, char **error_message) {
    @autoreleasepool {
        if (error_message) *error_message = NULL;
        NSString *name = [[NSFileManager defaultManager]
            stringWithFileSystemRepresentation:path length:strlen(path)];
        NSURL *url = [NSURL fileURLWithPath:name];
        BOOL accessing = [url startAccessingSecurityScopedResource];
        NSData *data = [NSData dataWithBytes:bytes length:length];
        __block BOOL success = NO;
        __block NSError *writeError = nil;
        NSError *coordinationError = nil;
        NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
        [coordinator coordinateWritingItemAtURL:url
                                       options:NSFileCoordinatorWritingForReplacing
                                         error:&coordinationError
                                    byAccessor:^(NSURL *destination) {
            NSFileManager *manager = [NSFileManager defaultManager];
            // This is on the destination's volume, including for a network or
            // external drive, so the final replacement stays atomic. A random
            // sibling .tmp file is outside a file-only Powerbox grant (#241).
            NSURL *directory = [manager URLForDirectory:NSItemReplacementDirectory
                                              inDomain:NSUserDomainMask
                                     appropriateForURL:destination
                                                create:YES error:&writeError];
            if (!directory) return;
            NSURL *staged = [directory URLByAppendingPathComponent:@"replacement"];
            if ([data writeToURL:staged options:NSDataWritingWithoutOverwriting error:&writeError]) {
                int fd = open(staged.fileSystemRepresentation, O_RDONLY);
                int syncError = fd < 0 ? errno : (fsync(fd) == 0 ? 0 : errno);
                if (fd >= 0) close(fd);
                if (syncError) {
                    writeError = [NSError errorWithDomain:NSPOSIXErrorDomain code:syncError userInfo:nil];
                } else {
                    NSData *verified = [NSData dataWithContentsOfURL:staged options:0 error:&writeError];
                    if (verified && [verified isEqualToData:data]) {
                        if ([manager fileExistsAtPath:destination.path]) {
                            success = [manager replaceItemAtURL:destination withItemAtURL:staged
                                                backupItemName:nil options:0 resultingItemURL:NULL
                                                         error:&writeError];
                        } else {
                            success = [manager moveItemAtURL:staged toURL:destination error:&writeError];
                        }
                    } else if (!writeError) {
                        writeError = [NSError errorWithDomain:NSCocoaErrorDomain code:NSFileWriteUnknownError
                                                    userInfo:@{NSLocalizedDescriptionKey: @"Replacement verification failed"}];
                    }
                }
            }
            // Remove only the unique folder Foundation created for this write.
            [manager removeItemAtURL:directory error:NULL];
        }];
        if (accessing) [url stopAccessingSecurityScopedResource];
        if (coordinationError) success = NO;
        if (!success && error_message) {
            NSError *error = coordinationError ?: writeError;
            NSString *message = error ? error.description : @"macOS file replacement failed";
            *error_message = strdup(message.UTF8String);
        }
        return success ? 1 : 0;
    }
}

void opendraft_macos_free_error(char *message) {
    free(message);
}
