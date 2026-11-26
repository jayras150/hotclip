import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none tracking-wide whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-[var(--border)] bg-white/[0.05] text-[var(--text-muted)]',
        accent:
          'border-transparent bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]',
        success:
          'border-transparent bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-[var(--success)]',
        warning:
          'border-transparent bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] text-[var(--warning)]',
        danger:
          'border-transparent bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] text-[var(--danger)]',
        outline: 'border-[var(--border-strong)] bg-transparent text-[var(--text)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(({ className, variant, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
));
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
