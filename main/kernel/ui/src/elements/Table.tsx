// main/kernel/ui/src/elements/Table.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithRef, ReactElement } from 'react';

export function Table({ className, ref, ...props }: ComponentPropsWithRef<'table'>): ReactElement {
  return (
    <div className="table-container">
      <table ref={ref} className={cn('table', className)} {...props} />
    </div>
  );
}

export function TableHeader({
  className,
  ref,
  ...props
}: ComponentPropsWithRef<'thead'>): ReactElement {
  return <thead ref={ref} className={cn('table-header', className)} {...props} />;
}

export function TableBody({
  className,
  ref,
  ...props
}: ComponentPropsWithRef<'tbody'>): ReactElement {
  return <tbody ref={ref} className={cn('table-body', className)} {...props} />;
}

export function TableFooter({
  className,
  ref,
  ...props
}: ComponentPropsWithRef<'tfoot'>): ReactElement {
  return <tfoot ref={ref} className={cn('table-footer', className)} {...props} />;
}

export function TableRow({ className, ref, ...props }: ComponentPropsWithRef<'tr'>): ReactElement {
  return <tr ref={ref} className={cn('table-row', className)} {...props} />;
}

export function TableHead({ className, ref, ...props }: ComponentPropsWithRef<'th'>): ReactElement {
  return <th ref={ref} className={cn('table-head', className)} {...props} />;
}

export function TableCell({ className, ref, ...props }: ComponentPropsWithRef<'td'>): ReactElement {
  return <td ref={ref} className={cn('table-cell', className)} {...props} />;
}

export function TableCaption({
  className,
  ref,
  ...props
}: ComponentPropsWithRef<'caption'>): ReactElement {
  return <caption ref={ref} className={cn('table-caption', className)} {...props} />;
}
