// main/kernel/ui/src/elements/Avatar.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithRef, ReactElement } from 'react';

type AvatarProps = ComponentPropsWithRef<'div'> & {
  src?: string;
  alt?: string;
  fallback?: string;
};

export function Avatar({ src, alt, fallback, className, ref, ...rest }: AvatarProps): ReactElement {
  const imageAlt =
    alt ?? (fallback != null && fallback !== '' ? `Avatar for ${fallback}` : 'User avatar');

  return (
    <div
      ref={ref}
      className={cn('avatar', className)}
      role="img"
      aria-label={
        (src == null || src === '') && fallback != null && fallback !== '' ? imageAlt : undefined
      }
      {...rest}
    >
      {src != null && src !== '' ? (
        <img src={src} alt={imageAlt} loading="lazy" decoding="async" />
      ) : fallback != null && fallback !== '' ? (
        <span aria-hidden="true">{fallback}</span>
      ) : null}
    </div>
  );
}
