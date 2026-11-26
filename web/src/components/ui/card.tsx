import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds a cyan edge glow to the card. */
  glow?: boolean;
  /** Slightly lighter glass layer (for nested surfaces). */
  elevated?: boolean;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, glow = false, elevated = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'relative rounded-[var(--radius-xl)] border border-[var(--border)] backdrop-blur-xl',
        elevated ? 'glass-2' : 'glass',
        glow && 'glow-border',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 p-4 sm:p-5', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        'font-[family-name:var(--font-display)] text-base font-semibold tracking-tight text-[var(--text)]',
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-[var(--text-muted)]', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-4 pt-0 sm:p-5 sm:pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center gap-2 p-4 pt-0 sm:p-5 sm:pt-0', className)}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
