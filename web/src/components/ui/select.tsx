'use client';

import { Select as BaseSelect } from '@base-ui-components/react/select';
import { Check, ChevronDown } from 'lucide-react';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from 'react';

import { cn } from '@/lib/cn';

const Select = BaseSelect.Root;
const SelectValue = BaseSelect.Value;
const SelectGroup = BaseSelect.Group;
const SelectGroupLabel = BaseSelect.GroupLabel;

const SelectTrigger = forwardRef<
  ElementRef<typeof BaseSelect.Trigger>,
  ComponentPropsWithoutRef<typeof BaseSelect.Trigger>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)]/70 px-3 text-sm text-[var(--text)] backdrop-blur-md transition-[border-color,box-shadow] hover:border-[var(--border-strong)] focus-visible:border-[var(--glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow)] disabled:cursor-not-allowed disabled:opacity-50 data-[popup-open]:border-[var(--glow)]',
      className,
    )}
    {...props}
  >
    {children}
    <BaseSelect.Icon className="flex shrink-0 text-[var(--text-muted)] transition-transform duration-200 data-[popup-open]:rotate-180">
      <ChevronDown className="size-4" aria-hidden="true" />
    </BaseSelect.Icon>
  </BaseSelect.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

const SelectPopup = forwardRef<
  ElementRef<typeof BaseSelect.Popup>,
  ComponentPropsWithoutRef<typeof BaseSelect.Popup>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Popup
    ref={ref}
    className={cn(
      'glass-2 max-h-[min(320px,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto rounded-[var(--radius-lg)] p-1 shadow-[var(--shadow-card)] outline-none transition-[transform,opacity] duration-150 ease-out',
      'data-[starting-style]:opacity-0 data-[starting-style]:-translate-y-1 data-[starting-style]:scale-95',
      'data-[ending-style]:opacity-0 data-[ending-style]:-translate-y-1 data-[ending-style]:scale-95',
      className,
    )}
    {...props}
  >
    {children}
  </BaseSelect.Popup>
));
SelectPopup.displayName = 'SelectPopup';

/** Full composition: portal + positioner + popup, ready to hold items. */
export interface SelectContentProps
  extends ComponentPropsWithoutRef<typeof BaseSelect.Popup> {
  sideOffset?: number;
  alignItemWithTrigger?: boolean;
}

const SelectContent = forwardRef<ElementRef<typeof BaseSelect.Popup>, SelectContentProps>(
  ({ className, children, sideOffset = 6, alignItemWithTrigger = false, ...props }, ref) => (
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        sideOffset={sideOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="z-50 outline-none"
      >
        <SelectPopup ref={ref} className={className} {...props}>
          {children}
        </SelectPopup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  ),
);
SelectContent.displayName = 'SelectContent';

const SelectItem = forwardRef<
  ElementRef<typeof BaseSelect.Item>,
  ComponentPropsWithoutRef<typeof BaseSelect.Item>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Item
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center gap-2 rounded-[var(--radius-sm)] py-2 pl-3 pr-8 text-sm text-[var(--text)] outline-none transition-colors',
      'data-[highlighted]:bg-white/[0.07] data-[highlighted]:text-[var(--accent)]',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
      'data-[selected]:text-[var(--accent)]',
      className,
    )}
    {...props}
  >
    <BaseSelect.ItemText className="truncate">{children}</BaseSelect.ItemText>
    <BaseSelect.ItemIndicator className="absolute right-2 flex items-center">
      <Check className="size-4" aria-hidden="true" />
    </BaseSelect.ItemIndicator>
  </BaseSelect.Item>
));
SelectItem.displayName = 'SelectItem';

export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectPopup,
  SelectItem,
  SelectGroup,
  SelectGroupLabel,
};
