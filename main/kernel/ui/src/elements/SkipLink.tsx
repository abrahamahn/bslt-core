// main/kernel/ui/src/elements/SkipLink.tsx
import { useCallback, type ComponentPropsWithRef, type ReactElement } from 'react';

import { cn } from '../utils/cn';
import '../styles/elements.css';

type SkipLinkProps = Omit<ComponentPropsWithRef<'a'>, 'href'> & {
  targetId?: string;
  label?: string;
};

export function SkipLink({
  targetId = 'main-content',
  label = 'Skip to main content',
  className,
  ref,
  ...rest
}: SkipLinkProps): ReactElement {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>): void => {
      e.preventDefault();
      const target = document.getElementById(targetId);
      if (target !== null) {
        target.setAttribute('tabindex', '-1');
        target.focus();
        target.removeAttribute('tabindex');
      }
    },
    [targetId],
  );

  return (
    <a
      ref={ref}
      href={`#${targetId}`}
      className={cn('skip-link', className)}
      onClick={handleClick}
      {...rest}
    >
      {label}
    </a>
  );
}
