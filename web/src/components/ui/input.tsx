import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      'flex h-10 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)]/70 px-3 py-2 text-sm text-[var(--text)] backdrop-blur-md transition-[border-color,box-shadow] placeholder:text-[var(--text-muted)]/70 focus-visible:border-[var(--glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow)] disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-[var(--danger)]',
      'file:mr-2 file:rounded-[var(--radius-sm)] file:border-0 file:bg-[var(--surface)] file:px-2 file:py-1 file:text-xs file:text-[var(--text)]',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export { Input };
