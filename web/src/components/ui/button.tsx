'use client';

import { LoaderCircle } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none transition-[background,box-shadow,border-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:pointer-events-none disabled:opacity-50 active:translate-y-px',
  {
    variants: {
      variant: {
        default:
          'bg-[linear-gradient(100deg,var(--accent)_0%,var(--accent-2)_100%)] text-[#04121a] font-semibold shadow-[0_0_0_1px_rgba(0,240,255,0.25)] hover:shadow-[var(--shadow-glow)]',
        primary:
          'bg-[linear-gradient(100deg,var(--accent)_0%,var(--accent-2)_100%)] text-[#04121a] font-semibold shadow-[0_0_24px_rgba(0,240,255,0.2)] hover:shadow-[var(--shadow-glow)]',
        secondary:
          'glass text-[var(--text)] hover:border-[var(--glow)] hover:bg-white/[0.06]',
        ghost:
          'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-white/[0.05]',
        outline:
          'border border-[var(--border-strong)] bg-transparent text-[var(--text)] hover:border-[var(--glow)] hover:text-[var(--accent)] hover:shadow-[0_0_16px_var(--glow-soft)]',
        danger:
          'bg-[var(--danger)] text-white hover:bg-[color-mix(in_srgb,var(--danger)_85%,white)] shadow-[0_0_20px_rgba(239,68,68,0.25)]',
      },
      size: {
        sm: 'h-8 rounded-[var(--radius-sm)] px-3 text-xs',
        md: 'h-10 rounded-[var(--radius-md)] px-4 text-sm',
        lg: 'h-12 rounded-[var(--radius-lg)] px-6 text-base',
        icon: 'h-10 w-10 rounded-[var(--radius-md)]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Show a spinner and disable interactions. */
  loading?: boolean;
  /** Optional icon rendered before the label. */
  leftIcon?: ReactNode;
  /** Optional icon rendered after the label. */
  rightIcon?: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, loading = false, leftIcon, rightIcon, disabled, children, ...props },
    ref,
  ) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  ),
);
Button.displayName = 'Button';

export { Button, buttonVariants };
