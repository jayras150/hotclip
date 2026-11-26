'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type AdminMetricTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'accent';

export interface AdminMetricCardProps {
  /** Short metric label, e.g. "Total users". */
  label: string;
  /** Already formatted value, e.g. "1,204". */
  value: ReactNode;
  /** Optional supporting text under the value. */
  hint?: ReactNode;
  /** Optional icon (lucide-react element or any node). */
  icon?: ReactNode;
  /** Colour accent for the value. */
  tone?: AdminMetricTone;
  /** Renders a shimmering placeholder instead of the value. */
  loading?: boolean;
  className?: string;
}

const toneClass: Record<AdminMetricTone, string> = {
  neutral: 'text-[var(--text)]',
  ok: 'text-[var(--success)]',
  warn: 'text-[var(--warning)]',
  bad: 'text-[var(--danger)]',
  accent: 'text-[var(--accent)]',
};

/**
 * Compact metric tile used by the admin dashboard. Pure presentational
 * component: no data fetching, safe to render on the server.
 */
export function AdminMetricCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  loading = false,
  className,
}: AdminMetricCardProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)]',
        'bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            {label}
          </div>
          {loading ? (
            <div
              className="mt-2 h-6 w-24 animate-pulse rounded bg-white/10"
              role="status"
              aria-label={`Loading ${label}`}
            />
          ) : (
            <div
              className={cn(
                'mt-1.5 truncate font-mono text-2xl font-semibold tabular-nums',
                toneClass[tone],
              )}
            >
              {value}
            </div>
          )}
          {hint ? (
            <div className="mt-1 truncate text-xs text-[var(--text-muted)]">{hint}</div>
          ) : null}
        </div>
        {icon ? (
          <span
            aria-hidden="true"
            className="shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-white/[0.03] p-2 text-[var(--accent)]"
          >
            {icon}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default AdminMetricCard;
