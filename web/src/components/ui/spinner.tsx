import { LoaderCircle } from 'lucide-react';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  /** Pixel size of the spinner square. */
  size?: number;
}

const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(
  ({ className, size = 16, ...props }, ref) => (
    <span
      ref={ref}
      role="status"
      aria-label="Loading"
      className={cn('inline-flex text-[var(--accent)]', className)}
      {...props}
    >
      <LoaderCircle
        style={{ width: size, height: size }}
        className="animate-spin"
        aria-hidden="true"
      />
    </span>
  ),
);
Spinner.displayName = 'Spinner';

export { Spinner };
