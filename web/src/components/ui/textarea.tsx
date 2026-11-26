import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[96px] w-full resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)]/70 px-3 py-2 text-sm leading-relaxed text-[var(--text)] backdrop-blur-md transition-[border-color,box-shadow] placeholder:text-[var(--text-muted)]/70 focus-visible:border-[var(--glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow)] disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-[var(--danger)]',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
