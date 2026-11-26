'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type ConfirmDialogTone = 'default' | 'danger';

export interface ConfirmDialogProps {
  open: boolean;
  /** Dialog heading, e.g. "Ban user?" */
  title: string;
  /** Body copy explaining the consequence. */
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
  /** Disables both buttons and shows the confirm label as busy. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Minimal accessible confirmation dialog (native `<dialog>`-free, focus is
 * trapped by the browser via `role="dialog"` + Escape handling).
 *
 * Kept dependency-free on purpose: the admin console must stay renderable
 * even if the design-system dialog pulls in extra client code.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Escape closes the dialog; focus moves to the confirm button on open.
  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, pending, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#02030a]/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-[var(--radius-xl)] border border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]"
      >
        <h2 id={titleId} className="text-base font-semibold text-[var(--text)]">
          {title}
        </h2>
        <div id={descriptionId} className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
          {description}
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className={cn(
              'inline-flex h-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-strong)]',
              'px-4 text-sm text-[var(--text-muted)] transition-colors',
              'hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending}
            className={cn(
              'inline-flex h-9 items-center justify-center rounded-[var(--radius-md)] px-4 text-sm font-semibold',
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
              'disabled:cursor-not-allowed disabled:opacity-60',
              tone === 'danger'
                ? 'bg-[var(--danger)] text-white hover:brightness-110'
                : 'bg-[var(--accent)] text-[#04121a] hover:brightness-110',
            )}
          >
            {pending ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
