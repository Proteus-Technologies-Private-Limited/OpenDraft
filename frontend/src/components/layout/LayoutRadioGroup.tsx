import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

/** Button radios keep their existing actions, with one Tab stop per group. */
export default function LayoutRadioGroup({ as: Tag = 'div', children, ...props }: {
  as?: 'div' | 'span';
  className?: string;
  'aria-label': string;
  children: ReactNode;
}) {
  const root = useRef<HTMLElement | null>(null);
  const radios = () => Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button[role="radio"]') ?? [])
    .filter(button => !button.disabled && button.closest('[role="radiogroup"]') === root.current);

  useLayoutEffect(() => {
    const choices = radios();
    const entry = choices.find(button => button.getAttribute('aria-checked') === 'true') ?? choices[0];
    root.current?.querySelectorAll<HTMLButtonElement>('button[role="radio"]').forEach(button => {
      if (button.closest('[role="radiogroup"]') === root.current) button.tabIndex = button === entry ? 0 : -1;
    });
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const choices = radios();
    const index = choices.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = choices.length - 1;
    else if (event.key === 'ArrowDown') next = index + 1;
    else if (event.key === 'ArrowUp') next = index - 1;
    else if (event.key === 'ArrowRight') next = index + (rtl ? -1 : 1);
    else if (event.key === 'ArrowLeft') next = index + (rtl ? 1 : -1);
    else return;
    event.preventDefault();
    event.stopPropagation();
    const button = choices[(next + choices.length) % choices.length];
    button.focus();
    button.click();
  };

  return <Tag {...props} ref={node => { root.current = node; }} role="radiogroup" onKeyDown={onKeyDown}>{children}</Tag>;
}
