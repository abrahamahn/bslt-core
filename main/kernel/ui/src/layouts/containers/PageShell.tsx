// main/kernel/ui/src/layouts/containers/PageShell.tsx
import { cn } from '../../utils/cn';

import '../../styles/layouts.css';
import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react';

type PageShellSize = 'sm' | 'md' | 'lg' | 'full';
type PageShellGap = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

const PAGE_SIZES: ReadonlySet<string> = new Set(['sm', 'md', 'lg', 'full']);
const PAGE_GAPS: ReadonlySet<string> = new Set([
  'none',
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
  '2xl',
  '3xl',
]);

type PageHeaderProps = Omit<ComponentPropsWithRef<'header'>, 'title'> & {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
  ...rest
}: PageHeaderProps): ReactElement {
  return (
    <header className={cn('ui-page-header', className)} {...rest}>
      <div className="ui-page-header-copy">
        {eyebrow !== undefined && eyebrow !== null && eyebrow !== false ? (
          <div className="ui-page-header-eyebrow">{eyebrow}</div>
        ) : null}
        <h1 className="ui-page-header-title">{title}</h1>
        {description !== undefined && description !== null && description !== false ? (
          <p className="ui-page-header-description">{description}</p>
        ) : null}
      </div>
      {actions !== undefined && actions !== null && actions !== false ? (
        <div className="ui-page-header-actions">{actions}</div>
      ) : null}
    </header>
  );
}

type PageShellProps = ComponentPropsWithRef<'div'> & {
  size?: PageShellSize;
  gap?: PageShellGap;
  header?: ReactNode;
};

export function PageShell({
  size = 'lg',
  gap = 'lg',
  header,
  className,
  children,
  ...rest
}: PageShellProps): ReactElement {
  const resolvedSize = PAGE_SIZES.has(size) ? size : 'lg';
  const resolvedGap = PAGE_GAPS.has(gap) ? gap : 'lg';

  return (
    <div
      className={cn('ui-page-shell', className)}
      data-size={resolvedSize}
      data-gap={resolvedGap}
      {...rest}
    >
      {header}
      {children}
    </div>
  );
}
