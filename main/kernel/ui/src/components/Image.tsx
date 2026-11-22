// main/kernel/ui/src/components/Image.tsx
import { useState, type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';

import { cn } from '../utils/cn';

import '../styles/elements.css';

type ImageProps = Omit<ComponentPropsWithRef<'img'>, 'loading' | 'srcSet' | 'sizes'> & {
  src: string;
  alt: string;
  loading?: 'lazy' | 'eager';
  fallback?: ReactNode;
  aspectRatio?: string;
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  widths?: number[];
  cdnUrl?: (src: string, width: number) => string;
  sizes?: string;
};

function buildSrcSet(
  src: string,
  widths: readonly number[] | undefined,
  cdnUrl: ((src: string, width: number) => string) | undefined,
): string | undefined {
  if (widths === undefined || widths.length === 0) return undefined;

  const normalized = Array.from(new Set(widths.filter((w) => w > 0))).sort((a, b) => a - b);
  if (normalized.length === 0) return undefined;

  return normalized
    .map((w) => {
      let url = src;
      if (cdnUrl !== undefined) {
        try {
          url = cdnUrl(src, w);
        } catch {
          url = src;
        }
      }
      return `${url} ${String(w)}w`;
    })
    .join(', ');
}

export function Image({
  src,
  alt,
  loading = 'lazy',
  fallback,
  aspectRatio,
  objectFit = 'cover',
  widths,
  cdnUrl,
  sizes,
  className,
  style,
  onLoad,
  onError,
  ref,
  ...rest
}: ImageProps): ReactElement {
  const [loadedSrc, setLoadedSrc] = useState(src);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  if (loadedSrc !== src) {
    setLoadedSrc(src);
    setIsLoading(true);
    setHasError(false);
  }

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    setIsLoading(false);
    onLoad?.(e);
  };

  const handleError = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    setIsLoading(false);
    setHasError(true);
    onError?.(e);
  };

  const showFallback = (isLoading || hasError) && fallback != null;
  const srcSet = buildSrcSet(src, widths, cdnUrl);

  return (
    <div
      className={cn('image-container', className)}
      style={{
        aspectRatio: aspectRatio != null && aspectRatio !== '' ? aspectRatio : 'auto',
        ...style,
      }}
    >
      {showFallback ? <div className="image-fallback">{fallback}</div> : null}
      <img
        ref={ref}
        src={src}
        alt={alt}
        srcSet={srcSet}
        sizes={sizes}
        loading={loading}
        onLoad={handleLoad}
        onError={handleError}
        className="image"
        style={{
          objectFit,
          display: showFallback ? 'none' : 'block',
        }}
        {...rest}
      />
    </div>
  );
}
