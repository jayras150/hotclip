'use client';

import { Progress as BaseProgress } from '@base-ui-components/react/progress';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from 'react';

import { cn } from '@/lib/cn';

export interface ProgressProps
  extends ComponentPropsWithoutRef<typeof BaseProgress.Root> {
  /** Indeterminate loading look with a shimmer sweep. */
  indeterminate?: boolean;
}

const Progress = forwardRef<ElementRef<typeof BaseProgress.Root>, ProgressProps>(
  ({ className, indeterminate = false, ...props }, ref) => (
    <BaseProgress.Root
      ref={ref}
      className={cn('w-full', className)}
      {...props}
    >
      <BaseProgress.Track
        className={cn(
          'relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]',
          indeterminate && 'data-[progressing]:hidden',
        )}
      >
        <BaseProgress.Indicator
          className="relative h-full overflow-hidden rounded-full bg-[linear-gradient(90deg,var(--accent-2)_0%,var(--accent)_100%)] shadow-[0_0_12px_var(--glow)] transition-[width] duration-500 ease-out"
        >
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.65),transparent)]"
            style={{ animation: 'progress-shimmer 1.6s ease-in-out infinite' }}
          />
        </BaseProgress.Indicator>
      </BaseProgress.Track>
    </BaseProgress.Root>
  ),
);
Progress.displayName = 'Progress';

export { Progress };
