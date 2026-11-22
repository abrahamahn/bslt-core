// main/kernel/ui/src/layouts/containers/Primitives.test.tsx
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { AspectRatio, Center, Cluster, Grid, Inline, Stack } from './Primitives';

describe('Layout primitives', () => {
  describe('Stack', () => {
    it('renders vertical stack with configured gap, align, and justify', () => {
      const ref = createRef<HTMLDivElement>();
      render(
        <Stack ref={ref} gap="lg" align="center" justify="between" data-testid="stack">
          <span>Item A</span>
          <span>Item B</span>
        </Stack>,
      );

      const el = screen.getByTestId('stack');
      expect(el).toHaveClass('ui-stack');
      expect(el).toHaveAttribute('data-gap', 'lg');
      expect(el).toHaveAttribute('data-align', 'center');
      expect(el).toHaveAttribute('data-justify', 'between');
      expect(ref.current).toBe(el);
    });

    it('falls back safely when optional props are omitted or unrecognized at runtime', () => {
      render(
        <Stack
          gap={'bogus' as 'md'}
          align={'invalid' as 'stretch'}
          justify={'invalid' as 'start'}
          data-testid="stack-fallback"
        />,
      );

      const el = screen.getByTestId('stack-fallback');
      expect(el).toHaveAttribute('data-gap', 'md');
      expect(el).toHaveAttribute('data-align', 'stretch');
      expect(el).not.toHaveAttribute('data-justify');
      expect(el).toBeEmptyDOMElement();
    });
  });

  describe('Inline & Cluster', () => {
    it('renders Inline non-wrapping by default and Cluster wrapping by default', () => {
      render(
        <>
          <Inline gap="xs" align="baseline" data-testid="inline">
            <span>A</span>
          </Inline>
          <Cluster gap="sm" justify="end" data-testid="cluster">
            <span>B</span>
          </Cluster>
        </>,
      );

      const inlineEl = screen.getByTestId('inline');
      expect(inlineEl).toHaveClass('ui-inline');
      expect(inlineEl).toHaveAttribute('data-gap', 'xs');
      expect(inlineEl).toHaveAttribute('data-align', 'baseline');
      expect(inlineEl).toHaveAttribute('data-wrap', 'false');

      const clusterEl = screen.getByTestId('cluster');
      expect(clusterEl).toHaveClass('ui-cluster');
      expect(clusterEl).toHaveAttribute('data-gap', 'sm');
      expect(clusterEl).toHaveAttribute('data-justify', 'end');
    });

    it('normalizes invalid Inline and Cluster tokens to safe defaults', () => {
      render(
        <>
          <Inline gap={'bad' as 'sm'} align={'bad' as 'center'} wrap data-testid="inline-bad" />
          <Cluster
            gap={'bad' as 'sm'}
            align={'bad' as 'center'}
            justify={'bad' as 'start'}
            data-testid="cluster-bad"
          />
        </>,
      );

      expect(screen.getByTestId('inline-bad')).toHaveAttribute('data-gap', 'sm');
      expect(screen.getByTestId('inline-bad')).toHaveAttribute('data-align', 'center');
      expect(screen.getByTestId('inline-bad')).toHaveAttribute('data-wrap', 'true');
      expect(screen.getByTestId('cluster-bad')).toHaveAttribute('data-gap', 'sm');
      expect(screen.getByTestId('cluster-bad')).toHaveAttribute('data-align', 'center');
      expect(screen.getByTestId('cluster-bad')).toHaveAttribute('data-justify', 'start');
    });
  });

  describe('Grid', () => {
    it('renders fixed column count or auto-fit minItemWidth custom property', () => {
      render(
        <>
          <Grid columns={3} gap="xl" data-testid="grid-fixed">
            <div>1</div>
          </Grid>
          <Grid columns="auto" minItemWidth="20rem" data-testid="grid-auto">
            <div>2</div>
          </Grid>
        </>,
      );

      expect(screen.getByTestId('grid-fixed')).toHaveAttribute('data-columns', '3');
      expect(screen.getByTestId('grid-fixed')).toHaveAttribute('data-gap', 'xl');
      expect(screen.getByTestId('grid-auto')).toHaveAttribute('data-columns', 'auto');
      expect(screen.getByTestId('grid-auto').style.getPropertyValue('--ui-grid-min')).toBe('20rem');
    });

    it('falls back to auto columns and ignores blank minItemWidth on invalid inputs', () => {
      render(
        <Grid
          columns={99 as 3}
          gap={'unknown' as 'md'}
          minItemWidth="   "
          data-testid="grid-fallback"
        />,
      );

      const grid = screen.getByTestId('grid-fallback');
      expect(grid).toHaveAttribute('data-columns', 'auto');
      expect(grid).toHaveAttribute('data-gap', 'md');
      expect(grid.style.getPropertyValue('--ui-grid-min')).toBe('');
    });
  });

  describe('Center & AspectRatio', () => {
    it('renders Center and AspectRatio with typed token attributes', () => {
      render(
        <Center maxWidth="sm" gutters="md" intrinsic data-testid="center">
          <AspectRatio ratio="square" data-testid="ratio">
            <img alt="Preview" src="/preview.png" />
          </AspectRatio>
        </Center>,
      );

      const center = screen.getByTestId('center');
      expect(center).toHaveClass('ui-center');
      expect(center).toHaveAttribute('data-max-width', 'sm');
      expect(center).toHaveAttribute('data-gutters', 'md');
      expect(center).toHaveAttribute('data-intrinsic', 'true');

      const ratio = screen.getByTestId('ratio');
      expect(ratio).toHaveClass('ui-aspect-ratio');
      expect(ratio).toHaveAttribute('data-ratio', 'square');
    });

    it('falls back safely when Center or AspectRatio receives invalid token values', () => {
      render(
        <Center
          maxWidth={'invalid' as 'md'}
          gutters={'invalid' as 'lg'}
          data-testid="center-fallback"
        >
          <AspectRatio ratio={'invalid' as 'video'} data-testid="ratio-fallback" />
        </Center>,
      );

      const center = screen.getByTestId('center-fallback');
      expect(center).toHaveAttribute('data-max-width', 'md');
      expect(center).toHaveAttribute('data-gutters', 'lg');
      expect(center).toHaveAttribute('data-intrinsic', 'false');

      const ratio = screen.getByTestId('ratio-fallback');
      expect(ratio).toHaveAttribute('data-ratio', 'video');
    });
  });
});
