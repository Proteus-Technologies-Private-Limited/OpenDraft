import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

/** Button radios keep their existing actions, with one Tab stop per group. */
export default function LayoutRadioGroup({ as: Tag = 'div', manual = false, children, ...props }: {
  as?: 'div' | 'span';
  /** Layout-moving actions apply only on Space/Enter or click. */
  manual?: boolean;
  className?: string;
  'aria-label': string;
  children: ReactNode;
}) {
  const root = useRef<HTMLElement | null>(null);
  const radios = () => Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button[role="radio"]') ?? [])
    .filter(button => !button.disabled && button.closest('[role="radiogroup"]') === root.current);

  const setEntry = (entry: HTMLButtonElement | undefined) => {
    root.current?.querySelectorAll<HTMLButtonElement>('button[role="radio"]').forEach(button => {
      if (button.closest('[role="radiogroup"]') === root.current) button.tabIndex = button === entry ? 0 : -1;
    });
  };
  useLayoutEffect(() => {
    const choices = radios();
    const focused = choices.find(button => button === document.activeElement);
    setEntry((manual && focused) || choices.find(button => button.getAttribute('aria-checked') === 'true') || choices[0]);
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
    setEntry(button);
    button.focus();
    if (!manual) button.click();
  };

  return <Tag {...props} ref={node => { root.current = node; }} role="radiogroup" onKeyDown={onKeyDown}
    onBlur={event => {
      if (!manual || (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) return;
      const choices = radios();
      setEntry(choices.find(button => button.getAttribute('aria-checked') === 'true') || choices[0]);
    }}
    onClickCapture={event => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[role="radio"]') : null;
      // Space/click on an already checked radio must not run its action again
      // (moving a panel to its current group would otherwise reorder it).
      if (button?.closest('[role="radiogroup"]') === root.current && button?.getAttribute('aria-checked') === 'true') {
        event.preventDefault();
        event.stopPropagation();
      }
    }}>{children}</Tag>;
}
