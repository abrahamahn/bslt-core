// main/kernel/ui/src/components/Dialog.tsx
import { useControllableState } from '@bslt/react/hooks';
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../elements/Button';
import { Icon } from '../elements/Icon';
import { cn } from '../utils/cn';

import { FocusTrap } from './FocusTrap';

import '../styles/components.css';

type DialogSize = 'sm' | 'md' | 'lg' | 'xl';
type DialogHeightMode = 'auto' | 'tall';
type DialogVariant = 'dialog' | 'sheet' | 'drawer' | 'bottom-sheet';

const DIALOG_VARIANTS: ReadonlySet<string> = new Set(['dialog', 'sheet', 'drawer', 'bottom-sheet']);

type DialogContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  requestClose: () => void;
  modal: boolean;
  variant: DialogVariant;
  size: DialogSize;
  heightMode: DialogHeightMode;
  labelledBy?: string;
  describedBy?: string;
  setLabelledBy: (id?: string) => void;
  setDescribedBy: (id?: string) => void;
  triggerRef: RefObject<HTMLElement | null>;
};

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogContext(component: string): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (ctx == null) {
    throw new Error(`${component} must be used within <Dialog.Root>`);
  }
  return ctx;
}

type DialogRootProps = {
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onChange?: (open: boolean) => void;
  onClose?: () => void;
  size?: DialogSize;
  heightMode?: DialogHeightMode;
  modal?: boolean;
  variant?: DialogVariant;
  closeOnEscape?: boolean;
  closeOnOverlayClick?: boolean;
};

const DialogRoot = ({
  children,
  open,
  defaultOpen = false,
  onChange,
  onClose,
  size = 'sm',
  heightMode = 'auto',
  modal = true,
  variant = 'dialog',
  closeOnEscape = true,
  closeOnOverlayClick = true,
}: DialogRootProps): ReactElement | null => {
  const safeOnChange = typeof onChange === 'function' ? onChange : undefined;
  const safeOnClose = typeof onClose === 'function' ? onClose : undefined;

  const [currentOpen, setCurrentOpen] = useControllableState<boolean>({
    ...(open !== undefined && { value: open }),
    defaultValue: defaultOpen,
    ...(safeOnChange !== undefined && { onChange: safeOnChange }),
  });
  const isOpen = currentOpen ?? false;

  const [labelledBy, setLabelledBy] = useState<string | undefined>(undefined);
  const [describedBy, setDescribedBy] = useState<string | undefined>(undefined);
  const triggerRef = useRef<HTMLElement | null>(null);

  const setOpen = useCallback(
    (next: boolean): void => {
      setCurrentOpen(next);
    },
    [setCurrentOpen],
  );

  const requestClose = useCallback((): void => {
    safeOnClose?.();
    setOpen(false);
  }, [safeOnClose, setOpen]);

  const resolvedVariant: DialogVariant = DIALOG_VARIANTS.has(variant) ? variant : 'dialog';
  const mounted = typeof document !== 'undefined';

  const handleOverlayClick = useCallback((): void => {
    requestClose();
  }, [requestClose]);

  useEffect((): (() => void) | undefined => {
    if (!closeOnEscape || !isOpen) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('keydown', onKey);
    };
  }, [closeOnEscape, isOpen, requestClose]);

  const value: DialogContextValue = useMemo(
    () => ({
      open: isOpen,
      setOpen,
      requestClose,
      modal,
      variant: resolvedVariant,
      size,
      heightMode,
      ...(labelledBy !== undefined && { labelledBy }),
      ...(describedBy !== undefined && { describedBy }),
      setLabelledBy,
      setDescribedBy,
      triggerRef,
    }),
    [
      isOpen,
      setOpen,
      requestClose,
      modal,
      resolvedVariant,
      size,
      heightMode,
      labelledBy,
      describedBy,
    ],
  );

  const childArray = Children.toArray(children);
  const contentChildren = childArray.filter(
    (child) => isValidElement(child) && child.type === DialogContent,
  );
  const hasExplicitContent = contentChildren.length > 0;

  if (hasExplicitContent) {
    const nonContentChildren = childArray.filter(
      (child) => !isValidElement(child) || child.type !== DialogContent,
    );
    return (
      <DialogContext.Provider value={value}>
        {nonContentChildren}
        {isOpen && mounted
          ? createPortal(
              <>
                {modal ? (
                  <DialogOverlay onClick={closeOnOverlayClick ? handleOverlayClick : undefined} />
                ) : null}
                {contentChildren}
              </>,
              document.body,
            )
          : null}
      </DialogContext.Provider>
    );
  }

  if (!isOpen || !mounted) return null;

  return createPortal(
    <DialogContext.Provider value={value}>
      {modal ? (
        <DialogOverlay onClick={closeOnOverlayClick ? handleOverlayClick : undefined} />
      ) : null}
      <div
        className="modal"
        data-variant={resolvedVariant}
        role="dialog"
        aria-modal={modal ? 'true' : 'false'}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
      >
        <div
          className={cn(
            'modal-card',
            size !== 'sm' && `modal-card--${size}`,
            heightMode === 'tall' && 'modal-card--tall',
          )}
          data-variant={resolvedVariant}
        >
          {modal ? <FocusTrap>{children}</FocusTrap> : children}
        </div>
      </div>
    </DialogContext.Provider>,
    document.body,
  );
};

type DialogTriggerProps = ComponentPropsWithoutRef<'button'>;

const DialogTrigger = (props: DialogTriggerProps): ReactElement => {
  const { setOpen, triggerRef } = useDialogContext('Dialog.Trigger');
  const { className, type = 'button', ...rest } = props;
  return (
    <Button
      ref={triggerRef}
      type={type}
      className={className}
      onClick={(e) => {
        props.onClick?.(e);
        if (!e.defaultPrevented) setOpen(true);
      }}
      {...rest}
    />
  );
};

type DialogOverlayProps = ComponentPropsWithoutRef<'div'>;

const DialogOverlay = (props: DialogOverlayProps): ReactElement => {
  const { className, ...rest } = props;
  return <div className={cn('overlay', className)} {...rest} />;
};

type DialogContentProps = ComponentPropsWithoutRef<'div'> & {
  title?: ReactNode;
};

const DialogContent = (props: DialogContentProps): ReactElement | null => {
  const { title, className, children, ...rest } = props;
  const {
    open,
    modal,
    variant,
    size,
    heightMode,
    setLabelledBy,
    setDescribedBy,
    labelledBy,
    describedBy,
    requestClose,
    triggerRef,
  } = useDialogContext('Dialog.Content');
  const titleId = useId();
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect((): (() => void) | undefined => {
    if (title == null) return undefined;
    setLabelledBy(titleId);
    return (): void => {
      setLabelledBy(undefined);
    };
  }, [setLabelledBy, title, titleId]);

  useEffect((): (() => void) => {
    return (): void => {
      setDescribedBy(undefined);
    };
  }, [setDescribedBy]);

  useEffect((): void => {
    if (!open && triggerRef.current != null) {
      triggerRef.current.focus();
    }
  }, [open, triggerRef]);

  if (!open) return null;

  const innerCard = (
    <div
      className={cn(
        'modal-card',
        size !== 'sm' && `modal-card--${size}`,
        heightMode === 'tall' && 'modal-card--tall',
        className,
      )}
      data-variant={variant}
      {...rest}
      ref={(node) => {
        contentRef.current = node;
      }}
    >
      {title != null ? (
        <div id={titleId} className="dialog-title">
          {title}
        </div>
      ) : null}
      {children}
      <Button aria-label="Close dialog" className="dialog-close" onClick={requestClose}>
        <Icon name="close" size="sm" />
      </Button>
    </div>
  );

  return (
    <div
      className="modal"
      data-variant={variant}
      role="dialog"
      aria-modal={modal ? 'true' : 'false'}
      aria-labelledby={title != null ? titleId : labelledBy}
      aria-describedby={describedBy}
    >
      {modal ? <FocusTrap>{innerCard}</FocusTrap> : innerCard}
    </div>
  );
};

const DialogHeader = ({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<'div'>): ReactElement => (
  <div className={cn('modal-header', className)} {...rest}>
    {children}
  </div>
);

const DialogBody = ({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<'div'>): ReactElement => (
  <div className={cn('modal-body', className)} {...rest}>
    {children}
  </div>
);

const DialogFooter = ({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<'div'>): ReactElement => (
  <div className={cn('modal-footer', className)} {...rest}>
    {children}
  </div>
);

type DialogDescriptionProps = ComponentPropsWithoutRef<'p'>;

const DialogDescription = (props: DialogDescriptionProps): ReactElement => {
  const { className, ...rest } = props;
  const { setDescribedBy } = useDialogContext('Dialog.Description');
  const id = useId();

  useEffect((): (() => void) => {
    setDescribedBy(id);
    return (): void => {
      setDescribedBy(undefined);
    };
  }, [id, setDescribedBy]);

  return <p id={id} className={cn('modal-description', className)} {...rest} />;
};

type DialogTitleProps = ComponentPropsWithoutRef<'h2'>;

const DialogTitle = (props: DialogTitleProps): ReactElement => {
  const { className, children, ...rest } = props;
  const id = useId();
  const { setLabelledBy } = useDialogContext('Dialog.Title');

  useEffect((): (() => void) => {
    setLabelledBy(id);
    return (): void => {
      setLabelledBy(undefined);
    };
  }, [id, setLabelledBy]);

  return (
    <h2 id={id} className={cn('modal-title', className)} {...rest}>
      {children}
    </h2>
  );
};

type DialogCloseProps = ComponentPropsWithoutRef<'button'>;

const DialogClose = ({ children, ...rest }: DialogCloseProps): ReactElement => {
  const { requestClose } = useDialogContext('Dialog.Close');
  return (
    <Button onClick={requestClose} aria-label="Close" {...rest}>
      {children ?? 'Close'}
    </Button>
  );
};

export const Dialog = {
  Root: DialogRoot,
  Trigger: DialogTrigger,
  Overlay: DialogOverlay,
  Content: DialogContent,
  Header: DialogHeader,
  Title: DialogTitle,
  Description: DialogDescription,
  Body: DialogBody,
  Footer: DialogFooter,
  Close: DialogClose,
};
