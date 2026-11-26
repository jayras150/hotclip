import { forwardRef, type LabelHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

const Label = forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      'inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)] select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Label.displayName = 'Label';

export { Label };
