// main/kernel/ui/src/components/Card.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithoutRef, ElementType, ReactElement, Ref } from 'react';

type CardRootProps = ComponentPropsWithoutRef<'div'> & {
  /** The HTML element or React component to render as */
  as?: ElementType;
  ref?: Ref<HTMLElement> | undefined;
};
/** Props for Card section sub-components (Header, Body, Footer). */
type CardSectionProps = ComponentPropsWithoutRef<'div'>;

const CardRoot = ({
  as = 'div',
  className,
  children,
  ref,
  ...rest
}: CardRootProps): ReactElement => {
  const Component: ElementType = as;
  return (
    <Component ref={ref} className={cn('card', className)} {...rest}>
      {children}
    </Component>
  );
};

/** Card header section for titles and actions. */
const CardHeader = ({ className, children, ...rest }: CardSectionProps): ReactElement => {
  return (
    <div className={cn('card-header', className)} {...rest}>
      {children}
    </div>
  );
};

/** Card body section for main content. */
const CardBody = ({ className, children, ...rest }: CardSectionProps): ReactElement => {
  return (
    <div className={cn('card-body', className)} {...rest}>
      {children}
    </div>
  );
};

/** Card footer section for actions and metadata. */
const CardFooter = ({ className, children, ...rest }: CardSectionProps): ReactElement => {
  return (
    <div className={cn('card-footer', className)} {...rest}>
      {children}
    </div>
  );
};

export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Body: CardBody,
  Footer: CardFooter,
});
