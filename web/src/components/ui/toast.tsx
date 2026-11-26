'use client';

import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { cn } from '@/lib/cn';

type ToastKind = 'success' | 'error' | 'info';

interface ToastRecord {
  id: string;
  kind: ToastKind;
  message: string;
  title?: string;
  duration: number;
}

type Listener = (toasts: ToastRecord[]) => void;

let toasts: ToastRecord[] = [];
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  const snapshot = toasts.slice();
  listeners.forEach((listener) => listener(snapshot));
}

function dismiss(id: string) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, message: string, options?: { title?: string; duration?: number }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const duration = options?.duration ?? 4000;
  toasts = [...toasts, { id, kind, message, title: options?.title, duration }].slice(-4);
  emit();
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => dismiss(id), duration),
    );
  }
  return id;
}

/** Imperative toast API. Render `<Toaster />` once near the app root. */
export const toast = {
  success: (message: string, options?: { title?: string; duration?: number }) =>
    push('success', message, options),
  error: (message: string, options?: { title?: string; duration?: number }) =>
    push('error', message, options),
  info: (message: string, options?: { title?: string; duration?: number }) =>
    push('info', message, options),
  dismiss,
};

const ICONS: Record<ToastKind, typeof Info> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
};

const TONES: Record<ToastKind, string> = {
  success: 'text-[var(--success)]',
  error: 'text-[var(--danger)]',
  info: 'text-[var(--accent)]',
};

export interface ToasterProps {
  /** Position of the stack. Defaults to bottom-right on desktop, bottom on mobile. */
  position?: 'top-right' | 'bottom-right' | 'bottom-center';
}

export function Toaster({ position = 'bottom-right' }: ToasterProps) {
  const [items, setItems] = useState<ToastRecord[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const listener: Listener = (next) => setItems(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const handleDismiss = useCallback((id: string) => dismiss(id), []);

  if (!mounted) return null;

  const positionClass =
    position === 'top-right'
      ? 'top-4 right-4 items-end'
      : position === 'bottom-center'
        ? 'bottom-4 left-1/2 -translate-x-1/2 items-center'
        : 'bottom-4 right-4 items-end max-sm:left-4 max-sm:right-4 max-sm:items-stretch';

  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        'pointer-events-none fixed z-[100] flex w-auto max-w-[calc(100vw-2rem)] flex-col gap-2 sm:w-[360px]',
        positionClass,
      )}
    >
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <div
            key={item.id}
            role="status"
            className={cn(
              'glass pointer-events-auto flex items-start gap-3 rounded-[var(--radius-lg)] border-[var(--border)] p-3 shadow-[var(--shadow-card)]',
              'animate-[slide-in-right_240ms_cubic-bezier(0.22,1,0.36,1)_both]',
            )}
          >
            <Icon className={cn('mt-0.5 size-4 shrink-0', TONES[item.kind])} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              {item.title && (
                <p className="text-sm font-semibold text-[var(--text)]">{item.title}</p>
              )}
              <p className="break-words text-sm text-[var(--text-muted)]">{item.message}</p>
            </div>
            <button
              type="button"
              onClick={() => handleDismiss(item.id)}
              aria-label="Dismiss notification"
              className="rounded-[var(--radius-sm)] p-1 text-[var(--text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow)]"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
