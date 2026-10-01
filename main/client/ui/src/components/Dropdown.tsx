// main/client/ui/src/components/Dropdown.tsx
import { useDisclosure } from '@hooks/useDisclosure';
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

import { Button } from '../elements/Button';

import '../styles/components.css';

/** Menu placement relative to the trigger element. */
type Placement = 'bottom' | 'right';

type DropdownProps = {
  /** Trigger button content */
  trigger: ReactNode;
  /** Accessible name for the trigger button (for icon-only triggers like avatars) */
  triggerAriaLabel?: string;
  /** Menu position relative to trigger */
  placement?: Placement;
  /** Menu content or render function with close callback */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Controlled open state */
  open?: boolean;
  /** Initial open state for uncontrolled usage */
  defaultOpen?: boolean;
  /** Callback when open state changes */
  onChange?: (open: boolean) => void;
};

/**
 * A dropdown menu with keyboard navigation and flexible content.
 *
 * @example
 * ```tsx
 * <Dropdown trigger={<Button>Menu</Button>}>
 *   <MenuItem>Edit</MenuItem>
 *   <MenuItem>Delete</MenuItem>
 * </Dropdown>
 * ```
 */
export const Dropdown = ({
  trigger,
  triggerAriaLabel,
  placement = 'bottom',
  children,
  open,
  defaultOpen,
  onChange,
}: DropdownProps): ReactElement => {
  const {
    open: isOpen,
    toggle,
    close,
    setOpen,
  } = useDisclosure({
    ...(open !== undefined && { open }),
    defaultOpen: defaultOpen ?? false,
    ...(onChange !== undefined && { onChange }),
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Standard menu behavior: pressing outside the dropdown dismisses it.
  useEffect((): (() => void) | undefined => {
    if (!isOpen) return undefined;

    const onPointerDown = (e: PointerEvent): void => {
      const root = rootRef.current;
      if (root !== null && e.target instanceof Node && !root.contains(e.target)) {
        close();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return (): void => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [close, isOpen]);

  useEffect((): (() => void) | undefined => {
    if (!isOpen) return undefined;

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // Focus first/last focusable element in menu
        const menuItems = menuRef.current?.querySelectorAll<HTMLElement>(
          'button, a, [tabindex]:not([tabindex="-1"])',
        );
        if (menuItems != null && menuItems.length > 0) {
          const target = e.key === 'ArrowDown' ? menuItems[0] : menuItems[menuItems.length - 1];
          target?.focus();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('keydown', onKey);
    };
  }, [close, isOpen]);

  return (
    <div ref={rootRef} className="dropdown" data-placement={placement}>
      <Button
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        {...(triggerAriaLabel !== undefined && { 'aria-label': triggerAriaLabel })}
        className="trigger-reset"
        onClick={() => {
          toggle();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!isOpen) {
              setOpen(true);
            }
          }
        }}
      >
        {trigger}
      </Button>
      {isOpen ? (
        <div ref={menuRef} className="dropdown-menu" role="menu" data-placement={placement}>
          {typeof children === 'function'
            ? (children as (close: () => void) => ReactNode)(() => {
                close();
              })
            : children}
        </div>
      ) : null}
    </div>
  );
};
