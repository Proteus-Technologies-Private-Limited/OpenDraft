import { useImperativeHandle, useRef, type HTMLAttributes, type Ref } from 'react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';

/** Preserves each dialog's existing dismissal and busy-state rules. */
export function ModalOverlay({ ref, dialogLabel, ...props }: HTMLAttributes<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>;
  dialogLabel?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useModalAccessibility(root, true, dialogLabel);
  useImperativeHandle(ref, () => root.current!, []);
  return <div {...props} ref={root} />;
}
