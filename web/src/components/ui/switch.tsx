'use client';

import { Switch as BaseSwitch } from '@base-ui-components/react/switch';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from 'react';

import { cn } from '@/lib/cn';

const Switch = forwardRef<
  ElementRef<typeof BaseSwitch.Root>,
  ComponentPropsWithoutRef<typeof BaseSwitch.Root>
>(({ className, ...props }, ref) => (
  <BaseSwitch.Root
    ref={ref}
    className={cn(
      'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-[var(--border)] bg-white/[0.06] transition-[background-color,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
      'data-[checked]:border-transparent data-[checked]:bg-[linear-gradient(100deg,var(--accent)_0%,var(--accent-2)_100%)] data-[checked]:shadow-[0_0_16px_var(--glow)]',
      'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <BaseSwitch.Thumb
      className={cn(
        'pointer-events-none block size-4 translate-x-1 rounded-full bg-[var(--text-muted)] shadow transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
        'data-[checked]:translate-x-6 data-[checked]:bg-[#04121a]',
      )}
    />
  </BaseSwitch.Root>
));
Switch.displayName = 'Switch';

export { Switch };
