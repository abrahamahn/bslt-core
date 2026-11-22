// main/kernel/ui/src/layouts/shells/ResizablePanel.tsx
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '../../utils/cn';
import '../../styles/components.css';

const KEYBOARD_STEP = 2;
const KEYBOARD_STEP_LARGE = 10;

type ResizablePanelProps = Omit<ComponentPropsWithRef<'div'>, 'onResize'> & {
  children: ReactNode;
  size?: number | undefined;
  defaultSize?: number | undefined;
  minSize?: number | undefined;
  maxSize?: number | undefined;
  unit?: '%' | 'px' | undefined;
  collapsed?: boolean | undefined;
  direction?: 'horizontal' | 'vertical' | undefined;
  invertResize?: boolean | undefined;
  onResize?: ((size: number) => void) | undefined;
};

type ResizablePanelGroupProps = ComponentPropsWithRef<'div'> & {
  children: ReactNode;
  direction?: 'horizontal' | 'vertical' | undefined;
  reverse?: boolean | undefined;
};

type ResizableSeparatorProps = Omit<ComponentPropsWithRef<'div'>, 'onResize'> & {
  direction?: 'horizontal' | 'vertical' | undefined;
  onResize?: ((delta: number) => void) | undefined;
  onSizeChange?: ((size: number) => void) | undefined;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  currentSize?: number;
  minSize?: number;
  maxSize?: number;
  unit?: '%' | 'px';
  ['aria-label']?: string;
};

export function ResizableSeparator({
  direction = 'horizontal',
  onResize,
  onSizeChange,
  onDragStart,
  onDragEnd,
  currentSize,
  minSize = 10,
  maxSize = 90,
  unit = '%',
  'aria-label': ariaLabel,
  className,
  ref,
  ...rest
}: ResizableSeparatorProps): ReactElement {
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef<number>(0);
  const onResizeRef = useRef(onResize);
  const onDragEndRef = useRef(onDragEnd);

  useLayoutEffect(() => {
    onResizeRef.current = onResize;
    onDragEndRef.current = onDragEnd;
  });

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragging(true);
    onDragStart?.();
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>): void => {
      if (currentSize === undefined || onSizeChange == null) return;

      const step = e.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
      let newSize: number | null = null;

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          newSize = Math.min(maxSize, currentSize + step);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          newSize = Math.max(minSize, currentSize - step);
          break;
        case 'Home':
          e.preventDefault();
          newSize = minSize;
          break;
        case 'End':
          e.preventDefault();
          newSize = maxSize;
          break;
      }

      if (newSize !== null && newSize !== currentSize) {
        onSizeChange(newSize);
      }
    },
    [currentSize, maxSize, minSize, onSizeChange],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: globalThis.MouseEvent): void => {
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = currentPos - startPosRef.current;
      startPosRef.current = currentPos;
      onResizeRef.current?.(delta);
    };

    const handleMouseUp = (): void => {
      setIsDragging(false);
      onDragEndRef.current?.();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return (): void => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, direction]);

  const defaultLabel = direction === 'horizontal' ? 'Resize panel width' : 'Resize panel height';
  const sizeText = currentSize !== undefined ? ` (current: ${String(currentSize)}${unit})` : '';

  return (
    <div
      ref={ref}
      className={cn('resizable-separator', isDragging && 'dragging', className)}
      data-direction={direction}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      role="separator"
      tabIndex={0}
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
      aria-valuenow={currentSize ?? 50}
      aria-valuemin={minSize}
      aria-valuemax={maxSize}
      aria-label={ariaLabel ?? `${defaultLabel}${sizeText}`}
      {...rest}
    />
  );
}

export function ResizablePanel({
  children,
  size: controlledSize,
  defaultSize = 50,
  minSize = 10,
  maxSize = 90,
  unit = '%',
  collapsed = false,
  direction = 'horizontal',
  invertResize = false,
  onResize,
  className,
  style,
  ref,
  ...rest
}: ResizablePanelProps): ReactElement {
  const isControlled = controlledSize !== undefined;
  const [internalSize, setInternalSize] = useState(defaultSize);
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const size = isControlled ? controlledSize : internalSize;

  const handleResize = useCallback(
    (delta: number): void => {
      const adjustedDelta = invertResize ? -delta : delta;
      const prevSize = size;

      let newSize: number;
      if (unit === 'px') {
        newSize = Math.max(minSize, Math.min(maxSize, prevSize + adjustedDelta));
      } else {
        const containerEl = panelRef.current?.parentElement;
        const containerSize =
          containerEl != null
            ? direction === 'horizontal'
              ? containerEl.clientWidth
              : containerEl.clientHeight
            : direction === 'horizontal'
              ? window.innerWidth
              : window.innerHeight;
        const deltaPercent = (adjustedDelta / containerSize) * 100;
        newSize = Math.max(minSize, Math.min(maxSize, prevSize + deltaPercent));
      }

      if (!isControlled) {
        setInternalSize(newSize);
      }
      onResize?.(newSize);
    },
    [direction, invertResize, isControlled, maxSize, minSize, onResize, size, unit],
  );

  const handleSizeChange = useCallback(
    (newSize: number): void => {
      const clampedSize = Math.max(minSize, Math.min(maxSize, newSize));
      if (!isControlled) {
        setInternalSize(clampedSize);
      }
      onResize?.(clampedSize);
    },
    [isControlled, maxSize, minSize, onResize],
  );

  const currentSize = collapsed ? 0 : size;
  const flexBasis = unit === 'px' ? `${String(currentSize)}px` : `${String(currentSize)}%`;
  const panelStyle = {
    flexBasis,
    flexShrink: 0,
    flexGrow: 0,
    transition: isDragging ? 'none' : 'flex-basis 0.3s ease',
    ...style,
    ...(collapsed
      ? {
          borderTop: 'none',
          borderBottom: 'none',
          borderLeft: 'none',
          borderRight: 'none',
          padding: 0,
          overflow: 'hidden',
        }
      : {}),
  };

  const mergedRef = useCallback(
    (node: HTMLDivElement | null): void => {
      (panelRef as { current: HTMLDivElement | null }).current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref != null) {
        (ref as { current: HTMLDivElement | null }).current = node;
      }
    },
    [ref],
  );

  return (
    <>
      <div
        ref={mergedRef}
        className={cn('resizable-panel', className)}
        style={panelStyle}
        {...rest}
      >
        {children}
      </div>
      {!collapsed && (
        <ResizableSeparator
          direction={direction}
          onResize={handleResize}
          onSizeChange={handleSizeChange}
          onDragStart={() => {
            setIsDragging(true);
          }}
          onDragEnd={() => {
            setIsDragging(false);
          }}
          currentSize={size}
          minSize={minSize}
          maxSize={maxSize}
          unit={unit}
        />
      )}
    </>
  );
}

export function ResizablePanelGroup({
  children,
  direction = 'horizontal',
  reverse = false,
  className,
  style,
  ref,
  ...rest
}: ResizablePanelGroupProps): ReactElement {
  const getFlexDirection = (): 'row' | 'row-reverse' | 'column' | 'column-reverse' => {
    if (direction === 'horizontal') {
      return reverse ? 'row-reverse' : 'row';
    }
    return reverse ? 'column-reverse' : 'column';
  };

  return (
    <div
      ref={ref}
      className={cn('resizable-panel-group', className)}
      style={{ flexDirection: getFlexDirection(), ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
