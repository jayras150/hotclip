'use client';

import { useCallback, useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';

import { AdminMetricCard } from '@/components/admin/AdminMetricCard';
import { apiClient, ApiError } from '@/lib/api';

/** Row shape returned by `GET /api/admin/audit-logs` (`{ ok: true, data: ... }`). */
export interface AdminAuditRow {
  id: string;
  action: string;
  entity: string;
  entity_id?: string | null;
  admin_email?: string | null;
  ip?: string | null;
  created_at?: string;
  createdAt?: string;
}

const fmtDate = (row: AdminAuditRow): string => {
  const iso = row.created_at ?? row.createdAt;
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

/**
 * `/admin/audit` — read-only viewer for `admin_audit_logs`: every privileged
 * action performed from the console, newest first.
 */
export default function AdminAuditPage() {
  const [rows, setRows] = useState<AdminAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<AdminAuditRow[]>('/api/admin/audit-logs');
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold">
            Audit Logs
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            Trail of all privileged actions in the admin console.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="h-9 rounded-[var(--radius-md)] border border-[var(--border-strong)] px-4 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Refresh
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <AdminMetricCard
          label="Log entries"
          value={loading ? undefined : rows.length}
          loading={loading}
          icon={<ScrollText size={18} aria-hidden="true" />}
          tone="accent"
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger)]/10 px-4 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <section
        aria-label="Audit log entries"
        className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]"
      >
        {loading ? (
          <div className="p-6 text-sm text-[var(--text-muted)]">Loading audit logs…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-[var(--text-muted)]">No activity recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Admin console audit log</caption>
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  <th scope="col" className="px-4 py-3 font-semibold">Action</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Entity</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Entity ID</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Admin</th>
                  <th scope="col" className="px-4 py-3 font-semibold">IP</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--border)] last:border-b-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-mono text-xs text-[var(--accent)]">{row.action}</td>
                    <td className="px-4 py-3">{row.entity}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--text-muted)]">
                      {row.entity_id ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{row.admin_email ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--text-muted)]">{row.ip ?? '—'}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{fmtDate(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
