'use client';

import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactElement,
} from 'react';

import { cn } from '@/lib/cn';

/** Wraps a subtree so tooltips share timing. Mount once near the app root. */
const TooltipProvider = BaseTooltip.Provider;

const TooltipRoot = BaseTooltip.Root;

export interface TooltipProps extends ComponentPropsWithoutRef<typeof BaseTooltip.Root> {
  /** The trigger element (must accept a ref). */
  children: ReactElement<Record<string, unknown>>;
  /** Tooltip body. */
  content: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  className?: string;
}

const TooltipPopup = forwardRef<
  ElementRef<typeof BaseTooltip.Popup>,
  ComponentPropsWithoutRef<typeof BaseTooltip.Popup>
>(({ className, ...props }, ref) => (
  <BaseTooltip.Popup
    ref={ref}
    className={cn(
      'glass-2 z-50 max-w-[240px] rounded-[var(--radius-md)] px-2.5 py-1.5 text-xs leading-snug text-[var(--text)] shadow-[var(--shadow-card)] outline-none transition-[transform,opacity] duration-150 ease-out',
      'data-[starting-style]:opacity-0 data-[starting-style]:scale-95',
      'data-[ending-style]:opacity-0 data-[ending-style]:scale-95',
      className,
    )}
    {...props}
  />
));
TooltipPopup.displayName = 'TooltipPopup';

function Tooltip({ children, content, side = 'top', sideOffset = 8, className, ...props }: TooltipProps) {
  return (
    <BaseTooltip.Root {...props}>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={sideOffset} className="z-50">
          <TooltipPopup className={className}>{content}</TooltipPopup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export { Tooltip, TooltipProvider, TooltipRoot, TooltipPopup };
