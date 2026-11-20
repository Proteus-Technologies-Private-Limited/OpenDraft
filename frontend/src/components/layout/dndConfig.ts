/**
 * Drag and drop for the Layout dialog, on @dnd-kit (as the Beat Board and the
 * project lists use). Pointer, touch and keyboard all drag: PR #217's HTML5
 * drag did nothing on a touch screen.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
} from '@dnd-kit/core';

/** Pointer: under the pointer. Keyboard: whatever the dragged box overlaps. */
export const layoutCollision: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const hits = pointerWithin(args);
    if (hits.length > 0) return hits;
  }
  return rectIntersection(args);
};

export function useLayoutSensors() {
  return useSensors(
    // A few pixels before a drag starts, so a click still selects.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // A short press on touch, so a swipe still scrolls the lists.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );
}

/** Screen-reader announcements, named by `nameOf` (a drag or drop id → text). */
export function useLayoutAnnouncements(nameOf: (id: string) => string): Announcements {
  const { t } = useTranslation('toolbar');
  return useMemo(() => ({
    onDragStart: ({ active }) => t('layout.dnd.pickedUp', { name: nameOf(String(active.id)) }),
    onDragOver: ({ active, over }) => (over ? t('layout.dnd.over', { name: nameOf(String(active.id)), target: nameOf(String(over.id)) }) : undefined),
    onDragEnd: ({ active, over }) => (over
      ? t('layout.dnd.dropped', { name: nameOf(String(active.id)), target: nameOf(String(over.id)) })
      : t('layout.dnd.cancelled', { name: nameOf(String(active.id)) })),
    onDragCancel: ({ active }) => t('layout.dnd.cancelled', { name: nameOf(String(active.id)) }),
  }), [t, nameOf]);
}
