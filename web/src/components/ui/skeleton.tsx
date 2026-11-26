import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

/** Shimmer skeleton block. GPU-only sweep (transform), respects reduced motion. */
export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    aria-hidden="true"
    className={cn(
      'relative overflow-hidden rounded-[var(--radius-md)] bg-white/[0.05]',
      'after:absolute after:inset-0 after:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.07),transparent)] after:animate-[skeleton-shimmer_1.6s_ease-in-out_infinite] motion-reduce:after:hidden',
      className,
    )}
    {...props}
  />
));
Skeleton.displayName = 'Skeleton';

export { Skeleton };
