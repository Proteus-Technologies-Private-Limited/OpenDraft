// Fold posture for foldable iPhones (issue #231, WP4).
//
// WKWebView exposes none of the web fold APIs: no viewport segments, no
// Device Posture, and window.screen keeps reporting the cover screen after the
// device opens. UIKit has both pieces natively from iOS 27.1:
//
//   - UIHingeInteraction reports the hinge: closed, partially open or fully
//     open. Its update carries no hinge at all on a device without one, which
//     is the "not a foldable" answer.
//   - reservedRegionsOfKind:divisionRegionKind gives the crease, in this view's
//     coordinates. It is inactive while the device is fully open, so inactive
//     regions are included to keep the geometry. UIKit re-runs updateConstraints
//     on a view that read regions there whenever they change; there is no
//     notification or trait for it.
//
// A transparent tracker view, pinned over the WKWebView, does both and pushes
// the result into the page as window.__opendraftNativeFold plus an
// `opendraft:nativefold` event, which utils/foldPosture.ts reads. The web view
// is laid out with viewport-fit=cover at scale 1, so its points are the page's
// CSS pixels.
//
// Compiled against any SDK: the hinge calls are only built when the SDK has
// them (CI may build with an older Xcode) and only run on iOS 27.1+.

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 270100
#define OPENDRAFT_HAS_HINGE_API 1
#endif

static const void *kOpenDraftFoldTrackerKey = &kOpenDraftFoldTrackerKey;

@interface OpenDraftFoldTracker : UIView
@property (nonatomic, weak) WKWebView *webView;
/// "unknown" until the first hinge update; then closed / partiallyOpen /
/// fullyOpen, or "none" on a device without a hinge.
@property (nonatomic, copy) NSString *hingeStatus;
@property (nonatomic) double hingeAngle;
@property (nonatomic) CGRect division;
@property (nonatomic) BOOL hasDivision;
@property (nonatomic) BOOL divisionActive;
@property (nonatomic, copy) NSString *lastPushed;
@property (nonatomic) BOOL pushScheduled;
@property (nonatomic, strong) id hingeInteraction;
@end

@implementation OpenDraftFoldTracker

+ (BOOL)requiresConstraintBasedLayout {
    // updateConstraints is only called on views taking part in constraint-based
    // layout, and that is where UIKit tracks which views read reserved regions.
    return YES;
}

- (instancetype)initWithWebView:(WKWebView *)webView {
    self = [super initWithFrame:webView.bounds];
    if (!self) return nil;
    _webView = webView;
    _hingeStatus = @"unknown";
    self.userInteractionEnabled = NO;
    self.backgroundColor = UIColor.clearColor;
    self.opaque = NO;
    self.isAccessibilityElement = NO;
    self.accessibilityElementsHidden = YES;
    self.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    return self;
}

- (void)startObserving API_AVAILABLE(ios(27.1)) {
#ifdef OPENDRAFT_HAS_HINGE_API
    __weak OpenDraftFoldTracker *weakSelf = self;
    UIHingeInteraction *interaction = [[UIHingeInteraction alloc]
        initWithUpdateHandler:^(UIHingeInteraction *hinge, UIHingeInteractionUpdate *update) {
            OpenDraftFoldTracker *strongSelf = weakSelf;
            if (!strongSelf) return;
            UIHinge *state = update.hinge;
            if (!state) {
                strongSelf.hingeStatus = @"none";
                strongSelf.hingeAngle = 0;
            } else {
                switch (state.status) {
                    case UIHingeStatusClosed: strongSelf.hingeStatus = @"closed"; break;
                    case UIHingeStatusPartiallyOpen: strongSelf.hingeStatus = @"partiallyOpen"; break;
                    case UIHingeStatusFullyOpen: strongSelf.hingeStatus = @"fullyOpen"; break;
                    default: strongSelf.hingeStatus = @"unknown"; break;
                }
                strongSelf.hingeAngle = isfinite(state.angle) ? state.angle : 0;
            }
            // A posture change moves the crease too; read it again with the hinge.
            [strongSelf setNeedsUpdateConstraints];
            [strongSelf schedulePush];
        }];
    self.hingeInteraction = interaction;
    [self addInteraction:interaction];
#endif
    [self setNeedsUpdateConstraints];
}

- (void)readDivision {
#ifdef OPENDRAFT_HAS_HINGE_API
    if (@available(iOS 27.1, *)) {
        NSArray<UIViewReservedRegion *> *regions =
            [self reservedRegionsOfKind:[UIViewReservedRegionKind divisionRegionKind]
                                options:UIViewReservedRegionQueryOptionsIncludeInactive];
        // One crease on the devices that exist; prefer an active one if a
        // later device ever reports more.
        UIViewReservedRegion *chosen = nil;
        for (UIViewReservedRegion *region in regions) {
            if (!chosen || (region.isActive && !chosen.isActive)) chosen = region;
        }
        CGRect frame = chosen ? chosen.frame : CGRectNull;
        BOOL valid = chosen && !CGRectIsNull(frame) && isfinite(frame.origin.x) && isfinite(frame.origin.y)
            && isfinite(frame.size.width) && isfinite(frame.size.height);
        self.hasDivision = valid;
        self.division = valid ? frame : CGRectZero;
        self.divisionActive = valid && chosen.isActive;
    }
#endif
}

- (void)updateConstraints {
    // Read here so UIKit calls this again when the regions change.
    [self readDivision];
    [self schedulePush];
    [super updateConstraints];
}

- (void)layoutSubviews {
    [super layoutSubviews];
    // Opening and closing resize the web view; keep the viewport current.
    [self schedulePush];
}

/// Coalesce into one push per run-loop turn, and never evaluate script from
/// inside a layout pass.
- (void)schedulePush {
    if (self.pushScheduled) return;
    self.pushScheduled = YES;
    __weak OpenDraftFoldTracker *weakSelf = self;
    dispatch_async(dispatch_get_main_queue(), ^{
        OpenDraftFoldTracker *strongSelf = weakSelf;
        if (!strongSelf) return;
        strongSelf.pushScheduled = NO;
        [strongSelf push];
    });
}

- (NSString *)stateJSON {
    NSMutableDictionary *state = [@{
        @"hinge": self.hingeStatus ?: @"unknown",
        @"angle": @(self.hingeAngle),
        @"viewport": @{ @"width": @(CGRectGetWidth(self.bounds)), @"height": @(CGRectGetHeight(self.bounds)) },
    } mutableCopy];
    if (self.hasDivision) {
        state[@"division"] = @{
            @"x": @(self.division.origin.x), @"y": @(self.division.origin.y),
            @"width": @(self.division.size.width), @"height": @(self.division.size.height),
            @"active": @(self.divisionActive),
        };
    } else {
        state[@"division"] = [NSNull null];
    }
    NSError *error = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:state options:0 error:&error];
    if (!data) {
        NSLog(@"[OpenDraft] fold: could not encode posture: %@", error);
        return nil;
    }
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

- (void)push {
    WKWebView *webView = self.webView;
    if (!webView) return;
    // Nothing to say until the hinge has answered: an "unknown" with no
    // crease would only tell the page what it already assumes.
    if ([self.hingeStatus isEqualToString:@"unknown"] && !self.hasDivision) return;
    NSString *json = [self stateJSON];
    if (!json || [json isEqualToString:self.lastPushed]) return;
    self.lastPushed = json;
    NSString *script = [NSString stringWithFormat:
        @"(function(s){window.__opendraftNativeFold=s;"
         "window.dispatchEvent(new CustomEvent('opendraft:nativefold',{detail:s}));})(%@);", json];
    [webView evaluateJavaScript:script completionHandler:^(id result, NSError *err) {
        if (err) NSLog(@"[OpenDraft] fold: could not deliver posture to the page: %@", err);
    }];
}

/// The page reloaded or asked again: forget what it was told and tell it now.
- (void)resend {
    self.lastPushed = nil;
    [self setNeedsUpdateConstraints];
    [self schedulePush];
}

@end

/// Attach the fold tracker to a WKWebView, from the Tauri `fold_watch_start`
/// command (always called on the main thread, via Webview::with_webview).
/// Returns 1 when posture will be reported, 0 when this OS or SDK has no hinge
/// API. Safe to call again: a reloaded page gets the current state re-sent.
int ios_fold_attach(void *webview_ptr) {
    if (!webview_ptr) return 0;
    if (![NSThread isMainThread]) {
        NSLog(@"[OpenDraft] fold: attach called off the main thread; ignored");
        return 0;
    }
#ifdef OPENDRAFT_HAS_HINGE_API
    if (@available(iOS 27.1, *)) {
        id object = (__bridge id)webview_ptr;
        if (![object isKindOfClass:[WKWebView class]]) {
            NSLog(@"[OpenDraft] fold: attach was not given a WKWebView");
            return 0;
        }
        WKWebView *webView = (WKWebView *)object;
        OpenDraftFoldTracker *tracker = objc_getAssociatedObject(webView, kOpenDraftFoldTrackerKey);
        if (tracker && tracker.superview == webView) {
            [tracker resend];
            return 1;
        }
        tracker = [[OpenDraftFoldTracker alloc] initWithWebView:webView];
        [webView addSubview:tracker];
        objc_setAssociatedObject(webView, kOpenDraftFoldTrackerKey, tracker, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        [tracker startObserving];
        return 1;
    }
#endif
    return 0;
}
