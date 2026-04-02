/**
 * Touch gesture hooks for mobile devices.
 *
 * All gesture logic is centralized here — components consume these hooks
 * with minimal wiring. No external gesture library; vanilla touch/pointer events.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';

// ── Utility: detect touch device ────────────────────────────────────────────

/** Returns true when the device supports touch input. */
export function useIsTouchDevice(): boolean {
  const [isTouch] = useState(
    () => typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0,
  );
  return isTouch;
}

// ── Delayed unmount for CSS transitions ─────────────────────────────────────

export type AnimationState = 'entering' | 'entered' | 'exiting' | 'exited';

/**
 * Keeps a component in the DOM during its close animation.
 *
 * When `isOpen` flips true → sets shouldRender immediately, then on the
 * next frame sets animationState to 'entering' → 'entered'.
 * When `isOpen` flips false → sets 'exiting', waits `durationMs`, then
 * sets shouldRender=false and 'exited'.
 */
export function useDelayedUnmount(isOpen: boolean, durationMs = 250) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animationState, setAnimationState] = useState<AnimationState>(
    isOpen ? 'entered' : 'exited',
  );

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setAnimationState('entering');
      const raf = requestAnimationFrame(() => {
        // Double-rAF ensures the DOM has the 'entering' class before switching
        requestAnimationFrame(() => setAnimationState('entered'));
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setAnimationState('exiting');
      const timer = setTimeout(() => {
        setShouldRender(false);
        setAnimationState('exited');
      }, durationMs);
      return () => clearTimeout(timer);
    }
  }, [isOpen, durationMs]);

  return { shouldRender, animationState };
}

// ── Swipe from screen edge to open a panel ──────────────────────────────────

interface SwipeEdgeConfig {
  edge: 'left' | 'right';
  /** Width of the invisible hit zone at the edge (px). */
  edgeZonePx?: number;
  /** Minimum travel distance to trigger (px). */
  thresholdPx?: number;
  onSwipe: () => void;
  enabled?: boolean;
}

export function useSwipeEdge(config: SwipeEdgeConfig) {
  const {
    edge,
    edgeZonePx = 20,
    thresholdPx = 60,
    onSwipe,
    enabled = true,
  } = config;

  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handleStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      const inZone =
        edge === 'left'
          ? touch.clientX < edgeZonePx
          : touch.clientX > window.innerWidth - edgeZonePx;
      if (inZone) {
        startRef.current = { x: touch.clientX, y: touch.clientY };
      }
    };

    const handleEnd = (e: TouchEvent) => {
      if (!startRef.current) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startRef.current.x;
      const dy = Math.abs(touch.clientY - startRef.current.y);
      startRef.current = null;

      // Must travel far enough horizontally and more horizontal than vertical
      const travelledEnough =
        edge === 'left' ? dx > thresholdPx : -dx > thresholdPx;
      if (travelledEnough && Math.abs(dx) > dy) {
        onSwipe();
      }
    };

    const handleCancel = () => {
      startRef.current = null;
    };

    document.addEventListener('touchstart', handleStart, { passive: true });
    document.addEventListener('touchend', handleEnd, { passive: true });
    document.addEventListener('touchcancel', handleCancel);
    return () => {
      document.removeEventListener('touchstart', handleStart);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleCancel);
    };
  }, [edge, edgeZonePx, thresholdPx, onSwipe, enabled]);
}

// ── Swipe on a panel to dismiss it ──────────────────────────────────────────

interface SwipeDismissConfig {
  /** Swipe direction that dismisses (e.g. 'right' for a right-side panel). */
  direction: 'left' | 'right';
  /** Minimum travel to trigger dismiss (px). */
  thresholdPx?: number;
  onDismiss: () => void;
  enabled?: boolean;
}

export function useSwipeDismiss(
  ref: RefObject<HTMLElement | null>,
  config: SwipeDismissConfig,
) {
  const { direction, thresholdPx = 80, onDismiss, enabled = true } = config;
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let dragging = false;

    /** True when the touch started on an interactive element. */
    let onInteractive = false;

    const isInteractive = (target: HTMLElement | null): boolean => {
      if (!target || target === el) return false;
      // Walk up from target to panel, checking each element
      let node: HTMLElement | null = target;
      while (node && node !== el) {
        // Native interactive elements
        const tag = node.tagName;
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' ||
            tag === 'SELECT' || tag === 'A') return true;
        // ARIA roles
        const role = node.getAttribute('role');
        if (role === 'button' || role === 'link' || role === 'menuitem') return true;
        // Any element with cursor:pointer (set via CSS) is clickable
        if (getComputedStyle(node).cursor === 'pointer') return true;
        node = node.parentElement;
      }
      return false;
    };

    const handleStart = (e: TouchEvent) => {
      const t = e.touches[0];
      // Skip swipe tracking when the touch starts on an interactive element
      // so that buttons, inputs, and links inside the panel work normally.
      onInteractive = isInteractive(e.target as HTMLElement | null);
      if (onInteractive) { startRef.current = null; return; }
      startRef.current = { x: t.clientX, y: t.clientY };
      dragging = false;
    };

    const handleMove = (e: TouchEvent) => {
      if (onInteractive || !startRef.current) return;
      const t = e.touches[0];
      let dx = t.clientX - startRef.current.x;

      // Only allow movement in the dismiss direction
      if (direction === 'right' && dx < 0) dx = 0;
      if (direction === 'left' && dx > 0) dx = 0;

      // If moving mostly vertically, ignore (don't hijack scroll)
      const dy = Math.abs(t.clientY - startRef.current.y);
      if (dy > Math.abs(dx) && Math.abs(dx) < 20) return;

      // Dead zone: require ≥15px horizontal movement before starting drag.
      // Without this, tiny finger movements during a tap call preventDefault()
      // which suppresses the synthesized click event on mobile browsers.
      if (Math.abs(dx) < 15) return;

      if (!dragging) {
        dragging = true;
        el.style.transition = 'none'; // only disable transition once actual drag starts
      }
      e.preventDefault();
      el.style.transform = `translateX(${dx}px)`;
    };

    const handleEnd = (e: TouchEvent) => {
      if (onInteractive) { onInteractive = false; return; }
      if (!startRef.current || !dragging) {
        startRef.current = null;
        dragging = false;
        return;
      }
      const t = e.changedTouches[0];
      const dx = t.clientX - startRef.current.x;
      startRef.current = null;
      dragging = false;

      const dismissed =
        direction === 'right' ? dx > thresholdPx : -dx > thresholdPx;

      if (dismissed) {
        el.style.transition = 'transform 0.2s ease';
        el.style.transform = `translateX(${direction === 'right' ? '100%' : '-100%'})`;
        setTimeout(() => onDismissRef.current(), 200);
      } else {
        // Spring back
        el.style.transition = 'transform 0.25s ease';
        el.style.transform = '';
      }
    };

    const reset = () => {
      startRef.current = null;
      dragging = false;
      onInteractive = false;
      el.style.transition = '';
      el.style.transform = '';
    };

    el.addEventListener('touchstart', handleStart, { passive: true });
    el.addEventListener('touchmove', handleMove, { passive: false });
    el.addEventListener('touchend', handleEnd, { passive: true });
    el.addEventListener('touchcancel', reset);
    return () => {
      el.removeEventListener('touchstart', handleStart);
      el.removeEventListener('touchmove', handleMove);
      el.removeEventListener('touchend', handleEnd);
      el.removeEventListener('touchcancel', reset);
      reset();
    };
  }, [ref, direction, thresholdPx, enabled]);
}

// ── Pinch-to-zoom on the editor area ────────────────────────────────────────

interface PinchZoomConfig {
  currentZoom: number;
  onZoomChange: (zoom: number) => void;
  minZoom?: number;
  maxZoom?: number;
  enabled?: boolean;
}

export function usePinchZoom(
  ref: RefObject<HTMLElement | null>,
  config: PinchZoomConfig,
) {
  const {
    currentZoom,
    onZoomChange,
    minZoom = 50,
    maxZoom = 200,
    enabled = true,
  } = config;

  const stateRef = useRef({
    initialDistance: 0,
    initialZoom: currentZoom,
    active: false,
  });
  // Keep current zoom in ref so the touchstart captures the latest value
  const zoomRef = useRef(currentZoom);
  zoomRef.current = currentZoom;
  const onZoomRef = useRef(onZoomChange);
  onZoomRef.current = onZoomChange;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const getDistance = (t1: Touch, t2: Touch) =>
      Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

    const handleStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        stateRef.current = {
          initialDistance: getDistance(e.touches[0], e.touches[1]),
          initialZoom: zoomRef.current,
          active: true,
        };
      }
    };

    const handleMove = (e: TouchEvent) => {
      if (!stateRef.current.active || e.touches.length !== 2) return;
      e.preventDefault(); // prevent native pinch-zoom

      const dist = getDistance(e.touches[0], e.touches[1]);
      const ratio = dist / stateRef.current.initialDistance;

      // Dead zone: ignore tiny scale changes (prevents zoom during two-finger scroll)
      if (ratio > 0.95 && ratio < 1.05) return;

      // Dampen the ratio so zoom feels smooth rather than jumpy.
      // A factor of 0.4 means only 40% of the raw pinch movement is applied.
      const dampenedRatio = 1 + (ratio - 1) * 0.55;
      const newZoom = Math.round(
        Math.min(maxZoom, Math.max(minZoom, stateRef.current.initialZoom * dampenedRatio)),
      );
      onZoomRef.current(newZoom);
    };

    const handleEnd = () => {
      stateRef.current.active = false;
    };

    el.addEventListener('touchstart', handleStart, { passive: true });
    el.addEventListener('touchmove', handleMove, { passive: false });
    el.addEventListener('touchend', handleEnd);
    el.addEventListener('touchcancel', handleEnd);
    return () => {
      el.removeEventListener('touchstart', handleStart);
      el.removeEventListener('touchmove', handleMove);
      el.removeEventListener('touchend', handleEnd);
      el.removeEventListener('touchcancel', handleEnd);
    };
  }, [ref, minZoom, maxZoom, enabled]);
}
