'use client';

import { Dialog as BaseDialog } from '@base-ui-components/react/dialog';
import { X } from 'lucide-react';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';

const Dialog = BaseDialog.Root;
const DialogTrigger = BaseDialog.Trigger;
const DialogClose = BaseDialog.Close;
const DialogPortal = BaseDialog.Portal;

const DialogBackdrop = forwardRef<
  ElementRef<typeof BaseDialog.Backdrop>,
  ComponentPropsWithoutRef<typeof BaseDialog.Backdrop>
>(({ className, ...props }, ref) => (
  <BaseDialog.Backdrop
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-[#02030a]/75 backdrop-blur-sm transition-opacity duration-200',
      'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
      className,
    )}
    {...props}
  />
));
DialogBackdrop.displayName = 'DialogBackdrop';

const DialogViewport = forwardRef<
  ElementRef<typeof BaseDialog.Viewport>,
  ComponentPropsWithoutRef<typeof BaseDialog.Viewport>
>(({ className, ...props }, ref) => (
  <BaseDialog.Viewport
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-6',
      className,
    )}
    {...props}
  />
));
DialogViewport.displayName = 'DialogViewport';

const DialogPanel = forwardRef<
  ElementRef<typeof BaseDialog.Popup>,
  ComponentPropsWithoutRef<typeof BaseDialog.Popup>
>(({ className, ...props }, ref) => (
  <BaseDialog.Popup
    ref={ref}
    className={cn(
      'glass relative w-full max-w-lg rounded-t-[var(--radius-2xl)] border-[var(--border)] p-5 shadow-[var(--shadow-card)] outline-none transition-[transform,opacity] duration-200 ease-out sm:rounded-[var(--radius-xl)]',
      'data-[starting-style]:opacity-0 data-[starting-style]:translate-y-4 data-[starting-style]:scale-[0.97]',
      'data-[ending-style]:opacity-0 data-[ending-style]:translate-y-2 data-[ending-style]:scale-[0.98]',
      className,
    )}
    {...props}
  />
));
DialogPanel.displayName = 'DialogPanel';

const DialogHeader = ({ className, ...props }: { className?: string; children?: ReactNode }) => (
  <div className={cn('mb-4 flex flex-col gap-1.5 pr-8', className)} {...props} />
);

const DialogFooter = ({ className, ...props }: { className?: string; children?: ReactNode }) => (
  <div
    className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
    {...props}
  />
);

const DialogTitle = forwardRef<
  ElementRef<typeof BaseDialog.Title>,
  ComponentPropsWithoutRef<typeof BaseDialog.Title>
>(({ className, ...props }, ref) => (
  <BaseDialog.Title
    ref={ref}
    className={cn(
      'font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-[var(--text)]',
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

const DialogDescription = forwardRef<
  ElementRef<typeof BaseDialog.Description>,
  ComponentPropsWithoutRef<typeof BaseDialog.Description>
>(({ className, ...props }, ref) => (
  <BaseDialog.Description
    ref={ref}
    className={cn('text-sm text-[var(--text-muted)]', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';

/** Convenience composition: backdrop + viewport + panel in one element. */
export interface DialogContentProps
  extends ComponentPropsWithoutRef<typeof BaseDialog.Popup> {
  /** Hide the built-in top-right close button. */
  hideClose?: boolean;
}

const DialogContent = forwardRef<ElementRef<typeof BaseDialog.Popup>, DialogContentProps>(
  ({ className, children, hideClose = false, ...props }, ref) => (
    <DialogPortal>
      <DialogBackdrop />
      <DialogViewport>
        <DialogPanel ref={ref} className={className} {...props}>
          {children}
          {!hideClose && (
            <BaseDialog.Close
              aria-label="Close dialog"
              className="absolute right-4 top-4 rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow)]"
            >
              <X className="size-4" aria-hidden="true" />
            </BaseDialog.Close>
          )}
        </DialogPanel>
      </DialogViewport>
    </DialogPortal>
  ),
);
DialogContent.displayName = 'DialogContent';

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogBackdrop,
  DialogViewport,
  DialogPanel,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
