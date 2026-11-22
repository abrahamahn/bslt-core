// main/kernel/ui/src/elements/Icon.tsx
import { createElement, type ComponentPropsWithRef, type ReactElement } from 'react';

import { ICONS, type IconDefinition, type IconName, type IconNode } from '../icons.generated';
import { cn } from '../utils/cn';

import '../styles/elements.css';

type IconSize = 'sm' | 'md' | 'lg';

type IconProps = Omit<ComponentPropsWithRef<'svg'>, 'children'> & {
  /** Owned icon identifier from `main/kernel/ui/icons/*.svg` */
  readonly name: IconName;
  /** Preset size token (`sm` = 1rem, `md` = 1.5rem, `lg` = 2rem) */
  readonly size?: IconSize | undefined;
  /** Optional accessible label; when omitted, the icon is decorative (`aria-hidden="true"`) */
  readonly label?: string | undefined;
};

function renderIconNode(node: IconNode, index: number): ReactElement {
  return createElement(node.tag, { key: index, ...node.attrs });
}

export function Icon({
  name,
  size = 'md',
  label,
  className,
  ref,
  ...rest
}: IconProps): ReactElement {
  const def: IconDefinition = ICONS[name];
  const trimmedLabel = label?.trim() ?? '';
  const isSemantic = trimmedLabel.length > 0;

  return (
    <svg
      ref={ref}
      viewBox={def.viewBox}
      fill={def.fill}
      {...(def.stroke !== undefined ? { stroke: def.stroke } : {})}
      {...(def.strokeWidth !== undefined ? { strokeWidth: def.strokeWidth } : {})}
      {...(def.strokeLinecap !== undefined
        ? { strokeLinecap: def.strokeLinecap as 'round' | 'butt' | 'square' }
        : {})}
      {...(def.strokeLinejoin !== undefined
        ? { strokeLinejoin: def.strokeLinejoin as 'round' | 'bevel' | 'miter' }
        : {})}
      className={cn('ui-icon', `icon-${size}`, className)}
      {...(isSemantic ? { role: 'img', 'aria-label': trimmedLabel } : { 'aria-hidden': 'true' })}
      {...rest}
    >
      {def.nodes.map((node, index) => renderIconNode(node, index))}
    </svg>
  );
}
