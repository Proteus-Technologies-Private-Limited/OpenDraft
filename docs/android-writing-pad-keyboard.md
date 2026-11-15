# Writing-pad placement above the keyboard

Android 11+ windows expose their own read-only `OpenDraftKeyboard.snapshot()`
report alongside the existing `isVisible()` focus-restoration method. The report
contains a version, availability, visibility, WebView physical width/height and
the usable bottom and status/cutout top edges relative to that WebView. It contains no text or device
identifier. Window insets pass through to WebView unchanged.

Insets and global-layout changes publish an immutable copy on the UI thread.
A payload-free `opendraft:keyboardchange` event asks the page to read it; startup
also reads it, so an early event is harmless. Identical reports emit no event.
Each Activity owns its report, listener and lifecycle cleanup. R8 keeps both
JavaScript methods. No permissions, polling or keyboard-height guesses are added.

The writing pad converts the bottom edge using the current visual-viewport /
WebView width ratio (including pinch scale and visual panning), then intersects it with VisualViewport. It therefore
handles an edge-to-edge keyboard overlay and a WebView already resized above
the keyboard without subtracting twice. Hidden IME geometry is ignored. A
floating keyboard with no bottom inset does not establish a usable rectangle;
that case retains existing browser behavior. API 26–29 also retain that fallback.

An occluded docked pad temporarily floats. The floating pad is clamped above the
reported bottom and below the native safe top edge, uses the existing scrollable controls/sticky Insert row, and
retains its textarea, draft, selection and saved floating preferences. Dismissing
the keyboard restores eligible fold docking. Ordinary Android windows use the
same floating clamp; other platforms keep the existing browser geometry.

This is the writing-pad portion of #231's keyboard work. It does not implement
the pending custom-toolbar arrangement (#217), companion panes (#214), handwriting
recognition, floating-IME rectangle detection or physical-device validation.

## Verification

- Frontend cases cover scale conversion, visual offsets, intersection, resized
  views, unsupported/malformed reports and hidden stale insets.
- Browser integration supplies native-shaped geometry without resizing the
  viewport and checks retained field/focus/selection, control reachability,
  preference retention and docking on dismissal. This is synthetic geometry.
- Native Robolectric tests verify per-view geometry, resized views, visibility,
  inset pass-through and lifecycle cleanup. Older APIs have no bridge.
- Debug and R8 APK emulator checks require actual InputMethodManager visibility,
  native geometry and the pad above the IME in the original rotated fold phase.
  A final scenario uses ADB taps on the Keyboard toggle and Insert, verifies
  editing changes and an undoable insertion, and retains screenshots/reports.
  No script click substitutes for those control taps. The original twelve
  fold/IME/lifecycle phases remain intact.

Emulator coverage is not evidence of physical OEM keyboards, stylus recognition,
IME composition or assistive-technology behavior. No physical foldable, Mac or
iPhone was available for this contribution.
