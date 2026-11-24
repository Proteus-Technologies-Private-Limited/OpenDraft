//! Display-independent placement policy. Coordinates and sizes are physical pixels.
//! Native APIs and persistence live in desktop_windows.rs so this policy can be
//! tested without a window server or a particular monitor arrangement.

#[derive(Clone, Debug, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Invisible native frame margins, expressed in logical pixels.
#[derive(Clone, Copy, Default)]
pub struct FrameInsets {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

impl FrameInsets {
    fn physical(self, scale: f64) -> [i64; 4] {
        [self.left, self.top, self.right, self.bottom].map(|value| (value * scale).round() as i64)
    }
}

/// Reject resize events that already have maximized geometry before the
/// platform reports the corresponding window state.
pub fn fills_work_area(
    rect: &Rect,
    display: &Display,
    frame: FrameInsets,
    positioned: bool,
) -> bool {
    let [left, top, right, bottom] = frame.physical(display.scale);
    let area = &display.area;
    let x = i64::from(rect.x) + left;
    let y = i64::from(rect.y) + top;
    let width = i64::from(rect.width) - left - right;
    let height = i64::from(rect.height) - top - bottom;
    let close = |a: i64, b: i32| (a - i64::from(b)).abs() <= 1;
    (width - i64::from(area.width)).abs() <= 1
        && (height - i64::from(area.height)).abs() <= 1
        && (!positioned || (close(x, area.x) && close(y, area.y)))
}

#[derive(Clone, Debug, PartialEq)]
pub struct Display {
    pub name: Option<String>,
    pub area: Rect,
    pub scale: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    pub outer: Rect,
    pub inner: (u32, u32),
    pub display: Display,
}

impl Display {
    pub fn valid(&self) -> bool {
        self.area.width > 0
            && self.area.height > 0
            && self.scale.is_finite()
            && (0.25..=16.0).contains(&self.scale)
    }
}

impl Placement {
    pub fn valid(&self) -> bool {
        self.display.valid()
            && self.inner.0 > 0
            && self.inner.1 > 0
            && self.outer.width >= self.inner.0
            && self.outer.height >= self.inner.1
    }
}

/// Names alone are ambiguous for identical monitors. Prefer an exact layout
/// match, then a unique named display whose position/resolution may have changed.
pub fn matching_display<'a>(saved: &Display, displays: &'a [Display]) -> Option<&'a Display> {
    let mut matches = displays
        .iter()
        .filter(|d| d.valid() && d.name == saved.name);
    if let Some(exact) = matches
        .clone()
        .find(|d| d.area.x == saved.area.x && d.area.y == saved.area.y)
    {
        return Some(exact);
    }
    let first = matches.next()?;
    (saved.name.is_some() && matches.next().is_none()).then_some(first)
}

/// Fit a normal window inside one display's work area (excluding taskbars/docks).
/// Retain logical dimensions and offset across DPI changes; center after a
/// disconnect, rather than leaving the title bar or resize edge off screen.
pub fn restore(
    saved: &Placement,
    displays: &[Display],
    primary: &Display,
    frame: FrameInsets,
) -> Option<Placement> {
    if !saved.valid() || !primary.valid() {
        return None;
    }
    let existing = matching_display(&saved.display, displays);
    let target = existing.unwrap_or(primary);
    Some(fit(
        saved,
        target,
        existing.is_none(),
        0.0,
        (800.0, 600.0),
        frame,
    ))
}

/// New Window explicitly follows its caller, overriding any old slot's display.
pub fn new_window(origin: &Placement, frame: FrameInsets) -> Option<Placement> {
    origin
        .valid()
        .then(|| fit(origin, &origin.display, false, 32.0, (800.0, 600.0), frame))
}

fn pixels(value: f64) -> u32 {
    value.round().clamp(1.0, u32::MAX as f64) as u32
}

fn coordinate(value: f64) -> i32 {
    value.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32
}

fn fit(
    saved: &Placement,
    target: &Display,
    center: bool,
    cascade: f64,
    minimum: (f64, f64),
    frame: FrameInsets,
) -> Placement {
    let ratio = target.scale / saved.display.scale;
    let area = &target.area;
    let [left, top, right, bottom] = frame.physical(target.scale);
    let bounds = Rect {
        x: area.x.saturating_sub(left as i32),
        y: area.y.saturating_sub(top as i32),
        width: area.width.saturating_add((left + right) as u32),
        height: area.height.saturating_add((top + bottom) as u32),
    };
    let frame_w = ((saved.outer.width - saved.inner.0) as f64 * ratio)
        .round()
        .min(bounds.width.saturating_sub(1) as f64) as u32;
    let frame_h = ((saved.outer.height - saved.inner.1) as f64 * ratio)
        .round()
        .min(bounds.height.saturating_sub(1) as f64) as u32;
    let available_w = bounds.width.saturating_sub(frame_w).max(1);
    let available_h = bounds.height.saturating_sub(frame_h).max(1);
    let inner = (
        pixels(saved.inner.0 as f64 * ratio)
            .max(pixels(minimum.0 * target.scale))
            .min(available_w),
        pixels(saved.inner.1 as f64 * ratio)
            .max(pixels(minimum.1 * target.scale))
            .min(available_h),
    );
    let width = inner.0.saturating_add(frame_w).min(bounds.width);
    let height = inner.1.saturating_add(frame_h).min(bounds.height);
    let x = if center {
        bounds.x as f64 + (bounds.width - width) as f64 / 2.0
    } else {
        area.x as f64
            + (saved.outer.x as f64 - saved.display.area.x as f64) * ratio
            + cascade * target.scale
    };
    let y = if center {
        bounds.y as f64 + (bounds.height - height) as f64 / 2.0
    } else {
        area.y as f64
            + (saved.outer.y as f64 - saved.display.area.y as f64) * ratio
            + cascade * target.scale
    };
    Placement {
        outer: Rect {
            x: coordinate(x.clamp(
                bounds.x as f64,
                bounds.x as f64 + (bounds.width - width) as f64,
            )),
            y: coordinate(y.clamp(
                bounds.y as f64,
                bounds.y as f64 + (bounds.height - height) as f64,
            )),
            width,
            height,
        },
        inner,
        display: target.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(name: &str, x: i32, y: i32, width: u32, height: u32, scale: f64) -> Display {
        Display {
            name: Some(name.into()),
            area: Rect {
                x,
                y,
                width,
                height,
            },
            scale,
        }
    }

    fn window(display: &Display, x: i32, y: i32, width: u32, height: u32) -> Placement {
        Placement {
            display: display.clone(),
            outer: Rect {
                x,
                y,
                width: width + 8,
                height: height + 32,
            },
            inner: (width, height),
        }
    }

    fn visible(p: &Placement) {
        let a = &p.display.area;
        assert!(p.outer.x >= a.x && p.outer.y >= a.y);
        assert!(p.outer.x as i64 + p.outer.width as i64 <= a.x as i64 + a.width as i64);
        assert!(p.outer.y as i64 + p.outer.height as i64 <= a.y as i64 + a.height as i64);
    }

    #[test]
    fn invisible_frame_stays_outside_the_snapped_visible_edge() {
        let screen = display("primary", 0, 0, 1920, 1040, 1.0);
        let insets = FrameInsets {
            left: 7.0,
            top: 0.0,
            right: 7.0,
            bottom: 7.0,
        };
        let saved = window(&screen, -7, 0, 959, 1015);
        let result = restore(&saved, &[screen.clone()], &screen, insets).unwrap();
        assert_eq!(result.outer.x, -7);
        assert!(!fills_work_area(&result.outer, &screen, insets, true));
        let maximized = Rect {
            x: -7,
            y: 0,
            width: 1934,
            height: 1047,
        };
        assert!(fills_work_area(&maximized, &screen, insets, true));
    }

    #[test]
    fn restores_on_secondary_and_negative_coordinate_displays() {
        let primary = display("primary", 0, 0, 1920, 1040, 1.0);
        let second = display("second", -1920, -200, 1920, 1040, 1.0);
        let saved = window(&second, -1800, -100, 1000, 700);
        let restored = restore(
            &saved,
            &[primary.clone(), second],
            &primary,
            FrameInsets::default(),
        )
        .unwrap();
        assert_eq!(restored, saved);
        visible(&restored);
    }

    #[test]
    fn unplugged_display_falls_back_fully_inside_primary_work_area() {
        let primary = display("primary", 0, 40, 1024, 700, 1.0);
        let second = display("second", 1920, 0, 3840, 2160, 2.0);
        let saved = window(&second, 2100, 100, 2400, 1600);
        let restored =
            restore(&saved, &[primary.clone()], &primary, FrameInsets::default()).unwrap();
        assert_eq!(restored.display, primary);
        visible(&restored);
    }

    #[test]
    fn smaller_work_area_clamps_partial_overlap_and_minimum_size() {
        let old = display("primary", 0, 0, 1920, 1080, 1.0);
        let now = display("primary", 0, 24, 640, 440, 1.0);
        let saved = window(&old, 1800, 1000, 1280, 800);
        let restored = restore(&saved, &[now.clone()], &now, FrameInsets::default()).unwrap();
        visible(&restored);
        assert!(restored.inner.0 < 800 && restored.inner.1 < 600);
    }

    #[test]
    fn display_rearrangement_and_dpi_change_keep_logical_size_and_offset() {
        let old = display("second", 1920, 0, 1920, 1080, 1.0);
        let now = display("second", -3840, 0, 3840, 2160, 2.0);
        let saved = window(&old, 2020, 100, 1000, 700);
        let restored = restore(&saved, &[now.clone()], &now, FrameInsets::default()).unwrap();
        assert_eq!(restored.inner, (2000, 1400));
        assert_eq!((restored.outer.x, restored.outer.y), (-3640, 200));
        visible(&restored);
    }

    #[test]
    fn new_window_uses_originating_display_and_cascades_within_it() {
        let second = display("second", 1920, 0, 1920, 1040, 1.0);
        let origin = window(&second, 2000, 50, 1000, 700);
        let new = new_window(&origin, FrameInsets::default()).unwrap();
        assert_eq!(new.display, second);
        assert_eq!((new.outer.x, new.outer.y), (2032, 82));
        visible(&new);
        visible(
            &new_window(
                &window(&new.display, 3700, 900, 1000, 700),
                FrameInsets::default(),
            )
            .unwrap(),
        );
    }

    #[test]
    fn unnamed_or_duplicate_displays_require_an_exact_position() {
        let a = display("same", 0, 0, 1920, 1080, 1.0);
        let b = display("same", 1920, 0, 1920, 1080, 1.0);
        assert_eq!(matching_display(&b, &[a.clone(), b.clone()]), Some(&b));
        let missing = display("same", -1920, 0, 1920, 1080, 1.0);
        assert!(matching_display(&missing, &[a, b]).is_none());
    }

    #[test]
    fn varied_frames_sizes_and_offsets_always_fit_the_work_area() {
        let old = display("external", -1920, -1080, 1920, 1040, 1.0);
        for scale in [0.5, 1.0, 1.25, 2.0, 3.0] {
            for (width, height) in [(320, 200), (800, 600), (1920, 1040), (3840, 2160)] {
                let now = display("primary", -1600, 30, width, height, scale);
                for (x, y) in [(i32::MIN, i32::MAX), (-5000, -2000), (0, 0), (4000, 2000)] {
                    let saved = window(&old, x, y, 1280, 800);
                    let restored =
                        restore(&saved, &[now.clone()], &now, FrameInsets::default()).unwrap();
                    assert!(restored.valid());
                    visible(&restored);
                }
            }
        }
    }

    #[test]
    fn invalid_geometry_is_ignored_and_extreme_offsets_do_not_overflow() {
        let d = display("primary", 0, 0, 1920, 1040, 1.0);
        let mut saved = window(&d, i32::MAX, i32::MIN, 1000, 700);
        visible(&restore(&saved, &[d.clone()], &d, FrameInsets::default()).unwrap());
        saved.display.scale = f64::NAN;
        assert!(restore(&saved, &[d.clone()], &d, FrameInsets::default()).is_none());
        saved.display.scale = 1.0;
        saved.inner.0 = 0;
        assert!(new_window(&saved, FrameInsets::default()).is_none());
    }
}
