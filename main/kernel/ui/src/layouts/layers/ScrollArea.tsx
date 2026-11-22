// main/kernel/ui/src/layouts/layers/ScrollArea.tsx
import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '../../utils/cn';
import '../../styles/components.css';

type ScrollAreaProps = ComponentPropsWithRef<'div'> & {
  children: ReactNode;
  maxHeight?: string | number;
  maxWidth?: string | number;
  scrollbarWidth?: 'thin' | 'normal' | 'thick';
  hideDelay?: number;
  showOnHover?: boolean;
};

export function ScrollArea({
  children,
  maxHeight,
  maxWidth,
  scrollbarWidth = 'thin',
  hideDelay = 2000,
  showOnHover = true,
  className,
  style,
  ref,
  ...rest
}: ScrollAreaProps): ReactElement {
  const [isActive, setIsActive] = useState(false);
  const [isHoveringScrollbar, setIsHoveringScrollbar] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverRef = useRef(false);

  const clearHideTimer = (): void => {
    clearTimeout(timeoutRef.current);
  };

  const scheduleHide = (): void => {
    if (hideDelay <= 0) {
      return;
    }

    clearHideTimer();

    timeoutRef.current = setTimeout((): void => {
      setIsActive(false);
    }, hideDelay);
  };

  const handleScroll = (): void => {
    setIsActive(true);
    scheduleHide();
  };

  useEffect(() => {
    return (): void => {
      clearTimeout(timeoutRef.current);
    };
  }, []);

  const scrollbarSize = {
    thin: '0.25rem',
    normal: '0.5rem',
    thick: '0.75rem',
  }[scrollbarWidth];

  const scrollbarSizePx = Number.parseFloat(scrollbarSize) * 16;
  const showScrollbar = hideDelay === 0 || isActive;

  return (
    <div
      ref={ref}
      className={cn('scroll-area', className)}
      onScroll={handleScroll}
      onMouseMove={(event): void => {
        if (!showOnHover) {
          return;
        }

        const element = event.currentTarget;
        const rect = element.getBoundingClientRect();
        const isVertical = element.scrollHeight > element.clientHeight;
        const isHorizontal = element.scrollWidth > element.clientWidth;
        const overVertical =
          isVertical &&
          event.clientX >= rect.right - scrollbarSizePx &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
        const overHorizontal =
          isHorizontal &&
          event.clientY >= rect.bottom - scrollbarSizePx &&
          event.clientY <= rect.bottom &&
          event.clientX >= rect.left &&
          event.clientX <= rect.right;
        const hovering = overVertical || overHorizontal;

        if (hovering !== hoverRef.current) {
          hoverRef.current = hovering;
          setIsHoveringScrollbar(hovering);

          if (hovering) {
            clearHideTimer();
            setIsActive(true);
          } else {
            scheduleHide();
          }
        }
      }}
      onMouseLeave={(): void => {
        if (!showOnHover) {
          return;
        }

        if (hoverRef.current) {
          hoverRef.current = false;
          setIsHoveringScrollbar(false);
          scheduleHide();
        }
      }}
      data-scrollbar-visible={showScrollbar}
      data-scrollbar-hover={isHoveringScrollbar}
      style={{
        maxHeight,
        maxWidth,
        ['--scrollbar-size' as string]: scrollbarSize,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
