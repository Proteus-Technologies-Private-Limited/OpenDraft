/** A drop target for the Layout dialog that marks itself while something is over it. */
import React from 'react';
import { useDroppable, type Data } from '@dnd-kit/core';

/** A drop target that tells its children whether something is over it. */
function DropZone({ id, data, className, children, as: Tag = 'div', ...rest }: {
  id: string;
  data?: Data;
  className?: string;
  children?: React.ReactNode;
  as?: 'div' | 'section';
} & Omit<React.HTMLAttributes<HTMLElement>, 'id' | 'className' | 'children'>) {
  const { setNodeRef, isOver, active } = useDroppable({ id, data });
  const classes = [className, isOver ? 'is-over' : '', active ? 'is-dragging' : ''].filter(Boolean).join(' ');
  return <Tag ref={setNodeRef as never} className={classes} {...rest}>{children}</Tag>;
}

export default DropZone;
