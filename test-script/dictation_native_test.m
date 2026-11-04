// Run on macOS with Foundation; no microphone, device or speech assets needed.
#import "DictationSupport.h"
#include <stdio.h>
#include <stdlib.h>

static void check(NSString *language, NSString *current, NSArray<NSString *> *available,
                  NSString *expected) {
    NSMutableSet<NSLocale *> *locales = [NSMutableSet set];
    for (NSString *identifier in available) {
        [locales addObject:[NSLocale localeWithLocaleIdentifier:identifier]];
    }
    NSLocale *chosen = dictation_supported_locale(language,
        [NSLocale localeWithLocaleIdentifier:current], locales);
    NSString *actual = chosen ? dictation_locale_identifier(chosen.localeIdentifier) : nil;
    NSString *wanted = expected ? dictation_locale_identifier(expected) : nil;
    if (actual != wanted && ![actual isEqualToString:wanted]) {
        fprintf(stderr, "locale %s, current %s: got %s, expected %s\n",
            language.UTF8String, current.UTF8String, actual.UTF8String, wanted.UTF8String);
        exit(1);
    }
}

static void check_error(NSString *domain, NSInteger code, NSString *description,
                        BOOL onDevice, BOOL expectsGuidance) {
    NSError *error = [NSError errorWithDomain:domain code:code
        userInfo:@{NSLocalizedDescriptionKey: description}];
    NSString *message = dictation_recognition_error(error, onDevice);
    BOOL matches = expectsGuidance
        ? [message containsString:@"Restart OpenDraft"] &&
          [message containsString:@"Local Whisper"] &&
          [message containsString:@"Audio was not retried on Apple's servers."]
        : [message isEqualToString:description];
    if (!matches) {
        fprintf(stderr, "error %s/%ld (on-device=%d): unexpected message %s\n",
            domain.UTF8String, (long)code, onDevice, message.UTF8String);
        exit(1);
    }
}

int main(void) {
    @autoreleasepool {
        NSArray *english = @[@"en-AE", @"en-GB", @"en-IN", @"en-US"];
        check(@"en", @"en_GB", english, @"en-GB");
        check(@"en", @"en-IN", english, @"en-IN");
        check(@"en", @"fr_CA", english, @"en-US");
        check(@"en_US", @"en_GB", english, @"en-US");
        check(@"en-GB", @"en_IN", english, @"en-GB");
        check(@"en_GB", @"fr_CA", @[@"en_AE", @"en_GB", @"en_US"], @"en_GB");
        check(@"fr", @"fr_CA", @[@"fr-BE", @"fr-CA", @"fr-FR"], @"fr-CA");
        check(@"fr", @"en_GB", @[@"fr-BE", @"fr-CA", @"fr-FR"], @"fr-FR");
        check(@"de", @"de_DE", @[@"de-AT", @"de-DE"], @"de-DE");
        check(@"es", @"es_MX", @[@"es-419", @"es-ES", @"es-MX"], @"es-MX");
        check(@"es", @"en_GB", @[@"es-419", @"es-ES", @"es-MX"], @"es-ES");
        check(@"it", @"en_GB", @[@"it-CH", @"it-IT"], @"it-IT");
        check(@"pl", @"en_GB", @[@"pl-PL"], @"pl-PL");
        check(@"pt", @"pt_PT", @[@"pt-BR", @"pt-PT"], @"pt-PT");
        check(@"pt", @"en_GB", @[@"pt-BR", @"pt-PT"], @"pt-BR");
        check(@"ja", @"en_GB", @[@"ja-JP"], @"ja-JP");
        check(@"en", @"en_IN", @[@"en-ZA", @"en-GB"], @"en-GB");
        check(@"pl", @"en_GB", english, nil);
        check(@"en", @"en_GB", @[], nil);

        check_error(@"kLSRErrorDomain", 300, @"Failed to initialize recognizer", YES, YES);
        // Match the identity even when Apple's description is localized.
        check_error(@"kLSRErrorDomain", 300, @"Impossible d'initialiser la reconnaissance", YES, YES);
        check_error(@"kLSRErrorDomain", 300, @"Failed to initialize recognizer", NO, NO);
        check_error(@"kAFAssistantErrorDomain", 1110, @"No speech detected", YES, NO);
        check_error(@"kAFAssistantErrorDomain", 1107, @"Recognition was interrupted", YES, NO);
        check_error(@"kAFAssistantErrorDomain", 1101, @"Connection was invalidated", YES, NO);
        check_error(@"kLSRErrorDomain", 301, @"Request was canceled", YES, NO);
        check_error(@"kLSRErrorDomain", 102, @"Assets are not installed", YES, NO);
        check_error(@"kLSRErrorDomain", 201, @"Siri or Dictation is disabled", YES, NO);
        check_error(@"OtherDomain", 300, @"Failed to initialize recognizer", YES, NO);
        puts("19 native locale cases and 10 recognition error cases passed");
    }
    return 0;
}
