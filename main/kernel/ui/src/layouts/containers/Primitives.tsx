// main/kernel/ui/src/layouts/containers/Primitives.tsx
import { cn } from '../../utils/cn';

import '../../styles/layouts.css';
import type { CSSProperties, ComponentPropsWithRef, ReactElement } from 'react';

type LayoutGap = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
type StackAlign = 'start' | 'center' | 'end' | 'stretch';
type FlexAlign = 'start' | 'center' | 'end' | 'baseline' | 'stretch';
type FlexJustify = 'start' | 'center' | 'end' | 'between';
type GridColumns = 1 | 2 | 3 | 4 | 5 | 6 | 'auto';
type CenterMaxWidth = 'sm' | 'md' | 'lg' | 'prose';
type AspectRatioPreset = 'square' | 'video' | 'portrait' | 'wide';

const GAPS: ReadonlySet<string> = new Set(['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']);
const STACK_ALIGNS: ReadonlySet<string> = new Set(['start', 'center', 'end', 'stretch']);
const FLEX_ALIGNS: ReadonlySet<string> = new Set(['start', 'center', 'end', 'baseline', 'stretch']);
const FLEX_JUSTIFIES: ReadonlySet<string> = new Set(['start', 'center', 'end', 'between']);
const GRID_COLUMNS: ReadonlySet<string> = new Set(['1', '2', '3', '4', '5', '6', 'auto']);
const CENTER_WIDTHS: ReadonlySet<string> = new Set(['sm', 'md', 'lg', 'prose']);
const RATIOS: ReadonlySet<string> = new Set(['square', 'video', 'portrait', 'wide']);

function resolveToken<T extends string>(
  value: T | undefined,
  allowed: ReadonlySet<string>,
  fallback: T,
): T {
  return value !== undefined && allowed.has(value) ? value : fallback;
}

type StackProps = ComponentPropsWithRef<'div'> & {
  gap?: LayoutGap;
  align?: StackAlign;
  justify?: FlexJustify;
};

export function Stack({
  gap = 'md',
  align = 'stretch',
  justify,
  className,
  ...rest
}: StackProps): ReactElement {
  const resolvedGap = resolveToken(gap, GAPS, 'md');
  const resolvedAlign = resolveToken(align, STACK_ALIGNS, 'stretch');
  const resolvedJustify =
    justify !== undefined && FLEX_JUSTIFIES.has(justify) ? justify : undefined;

  return (
    <div
      className={cn('ui-stack', className)}
      data-gap={resolvedGap}
      data-align={resolvedAlign}
      data-justify={resolvedJustify}
      {...rest}
    />
  );
}

type InlineProps = ComponentPropsWithRef<'div'> & {
  gap?: LayoutGap;
  align?: FlexAlign;
  justify?: FlexJustify;
  wrap?: boolean;
};

export function Inline({
  gap = 'sm',
  align = 'center',
  justify,
  wrap = false,
  className,
  ...rest
}: InlineProps): ReactElement {
  const resolvedGap = resolveToken(gap, GAPS, 'sm');
  const resolvedAlign = resolveToken(align, FLEX_ALIGNS, 'center');
  const resolvedJustify =
    justify !== undefined && FLEX_JUSTIFIES.has(justify) ? justify : undefined;

  return (
    <div
      className={cn('ui-inline', className)}
      data-gap={resolvedGap}
      data-align={resolvedAlign}
      data-justify={resolvedJustify}
      data-wrap={wrap ? 'true' : 'false'}
      {...rest}
    />
  );
}

type ClusterProps = ComponentPropsWithRef<'div'> & {
  gap?: LayoutGap;
  align?: FlexAlign;
  justify?: FlexJustify;
};

export function Cluster({
  gap = 'sm',
  align = 'center',
  justify = 'start',
  className,
  ...rest
}: ClusterProps): ReactElement {
  const resolvedGap = resolveToken(gap, GAPS, 'sm');
  const resolvedAlign = resolveToken(align, FLEX_ALIGNS, 'center');
  const resolvedJustify = resolveToken(justify, FLEX_JUSTIFIES, 'start');

  return (
    <div
      className={cn('ui-cluster', className)}
      data-gap={resolvedGap}
      data-align={resolvedAlign}
      data-justify={resolvedJustify}
      {...rest}
    />
  );
}

type GridProps = ComponentPropsWithRef<'div'> & {
  columns?: GridColumns;
  gap?: LayoutGap;
  minItemWidth?: string;
};

export function Grid({
  columns = 'auto',
  gap = 'md',
  minItemWidth,
  style,
  className,
  ...rest
}: GridProps): ReactElement {
  const rawColumns = String(columns);
  const resolvedColumns = GRID_COLUMNS.has(rawColumns) ? rawColumns : 'auto';
  const resolvedGap = resolveToken(gap, GAPS, 'md');
  const trimmedMin = minItemWidth?.trim();
  const mergedStyle: CSSProperties | undefined =
    trimmedMin !== undefined && trimmedMin.length > 0
      ? ({ '--ui-grid-min': trimmedMin, ...style } as CSSProperties)
      : style;

  return (
    <div
      className={cn('ui-grid', className)}
      data-columns={resolvedColumns}
      data-gap={resolvedGap}
      style={mergedStyle}
      {...rest}
    />
  );
}

type CenterProps = ComponentPropsWithRef<'div'> & {
  maxWidth?: CenterMaxWidth;
  gutters?: LayoutGap;
  intrinsic?: boolean;
};

export function Center({
  maxWidth = 'md',
  gutters = 'lg',
  intrinsic = false,
  className,
  ...rest
}: CenterProps): ReactElement {
  const resolvedWidth = resolveToken(maxWidth, CENTER_WIDTHS, 'md');
  const resolvedGutters = resolveToken(gutters, GAPS, 'lg');

  return (
    <div
      className={cn('ui-center', className)}
      data-max-width={resolvedWidth}
      data-gutters={resolvedGutters}
      data-intrinsic={intrinsic ? 'true' : 'false'}
      {...rest}
    />
  );
}

type AspectRatioProps = ComponentPropsWithRef<'div'> & {
  ratio?: AspectRatioPreset;
};

export function AspectRatio({
  ratio = 'video',
  className,
  ...rest
}: AspectRatioProps): ReactElement {
  const resolvedRatio = resolveToken(ratio, RATIOS, 'video');

  return <div className={cn('ui-aspect-ratio', className)} data-ratio={resolvedRatio} {...rest} />;
}
