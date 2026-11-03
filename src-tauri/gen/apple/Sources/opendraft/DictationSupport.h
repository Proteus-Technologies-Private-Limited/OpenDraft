#ifndef OPENDRAFT_DICTATION_SUPPORT_H
#define OPENDRAFT_DICTATION_SUPPORT_H

#import <Foundation/Foundation.h>

// Apple's canonicalization preserves hyphens versus underscores. Normalize
// both supported identifiers and candidates before comparing regional locales.
static NSString *dictation_locale_identifier(NSString *identifier) {
    return [[NSLocale canonicalLocaleIdentifierFromString:identifier]
        stringByReplacingOccurrencesOfString:@"-" withString:@"_"];
}

static NSLocale *dictation_supported_locale(NSString *language, NSLocale *current,
                                           NSSet<NSLocale *> *availableLocales) {
    NSArray<NSLocale *> *supported = [[availableLocales allObjects]
        sortedArrayUsingComparator:^NSComparisonResult(NSLocale *a, NSLocale *b) {
            return [a.localeIdentifier compare:b.localeIdentifier];
        }];
    NSLocale *requested = [NSLocale localeWithLocaleIdentifier:language];
    NSString *code = [requested objectForKey:NSLocaleLanguageCode];
    if (!code.length) return nil;
    NSString *currentCode = [current objectForKey:NSLocaleLanguageCode];
    NSString *region = [current objectForKey:NSLocaleCountryCode];
    NSString *currentMatch = @"";
    if ([currentCode isEqualToString:code] && region.length) {
        currentMatch = [NSLocale localeIdentifierFromComponents:@{
            NSLocaleLanguageCode: code, NSLocaleCountryCode: region
        }];
    }
    NSDictionary<NSString *, NSString *> *defaults = @{
        @"en": @"en_US", @"pl": @"pl_PL", @"fr": @"fr_FR", @"de": @"de_DE",
        @"es": @"es_ES", @"it": @"it_IT", @"pt": @"pt_BR", @"ja": @"ja_JP"
    };
    for (NSString *candidate in @[language, currentMatch, defaults[code] ?: @""]) {
        if (!candidate.length) continue;
        NSString *identifier = dictation_locale_identifier(candidate);
        for (NSLocale *locale in supported) {
            NSString *available = dictation_locale_identifier(locale.localeIdentifier);
            if ([identifier caseInsensitiveCompare:available] == NSOrderedSame) return locale;
        }
    }
    // A supported regional variant is preferable to an unsupported bare code.
    for (NSLocale *locale in supported) {
        if ([[locale objectForKey:NSLocaleLanguageCode] isEqualToString:code]) return locale;
    }
    return nil;
}

static NSString *dictation_recognition_error(NSString *details, BOOL onDevice) {
    if (onDevice) {
        return @"Apple's on-device speech recognition failed. Restart OpenDraft and try again after the language's speech assets finish downloading. If it keeps failing, choose Local Whisper in Settings → Add-ons → Dictation. Audio was not retried on Apple's servers.";
    }
    return details;
}

#endif
