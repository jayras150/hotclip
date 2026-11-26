'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldBan, ShieldCheck, Users } from 'lucide-react';

import { AdminMetricCard } from '@/components/admin/AdminMetricCard';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { apiClient, ApiError } from '@/lib/api';

/** Row shape returned by `GET /api/admin/users` (`{ ok: true, data: AdminUserRow[] }`). */
export interface AdminUserRow {
  id: string;
  email: string;
  role: 'member' | 'admin' | string;
  status: 'active' | 'suspended' | 'disabled' | string;
  created_at?: string;
  createdAt?: string;
  creditsBalance?: number;
  bannedAt?: string | null;
  banReason?: string | null;
}

type PendingAction =
  | { kind: 'ban'; user: AdminUserRow }
  | { kind: 'unban'; user: AdminUserRow }
  | { kind: 'reset-quota'; user: AdminUserRow }
  | null;

const fmtDate = (row: AdminUserRow): string => {
  const iso = row.created_at ?? row.createdAt;
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const statusTone = (status: AdminUserRow['status']): string => {
  if (status === 'active') return 'text-[var(--success)]';
  if (status === 'suspended') return 'text-[var(--warning)]';
  return 'text-[var(--danger)]';
};

/**
 * `/admin/users` — tenant user management: ban/unban accounts and reset
 * wallet quotas. Data comes from the admin API (`/api/admin/users`).
 */
export default function AdminUsersPage() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<AdminUserRow[]>('/admin/users');
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat daftar user');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (action: NonNullable<PendingAction>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { kind, user } = action;
    const suffix = kind === 'ban' ? 'ban' : kind === 'unban' ? 'unban' : 'reset-quota';
    try {
      await apiClient.post(`/admin/users/${encodeURIComponent(user.id)}/${suffix}`);
      setNotice(
        kind === 'ban'
          ? `User ${user.email} dibanned`
          : kind === 'unban'
            ? `User ${user.email} di-unban`
            : `Kuota user ${user.email} direset`,
      );
      setPending(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aksi gagal dijalankan');
    } finally {
      setBusy(false);
    }
  };

  const bannedCount = rows.filter((r) => r.status !== 'active').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold">Users</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Kelola akses tenant: ban, unban, dan reset kuota.
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
          label="Total users"
          value={loading ? undefined : rows.length}
          loading={loading}
          icon={<Users size={18} aria-hidden="true" />}
          tone="accent"
        />
        <AdminMetricCard
          label="Active"
          value={loading ? undefined : Math.max(0, rows.length - bannedCount)}
          loading={loading}
          icon={<ShieldCheck size={18} aria-hidden="true" />}
          tone="ok"
        />
        <AdminMetricCard
          label="Banned"
          value={loading ? undefined : bannedCount}
          loading={loading}
          icon={<ShieldBan size={18} aria-hidden="true" />}
          tone="bad"
        />
      </div>

      {notice ? (
        <p role="status" className="rounded-[var(--radius-md)] border border-[var(--border)] bg-white/[0.03] px-4 py-2 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger)]/10 px-4 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <section
        aria-label="User list"
        className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]"
      >
        {loading ? (
          <div className="p-6 text-sm text-[var(--text-muted)]">Memuat user…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-[var(--text-muted)]">Belum ada user terdaftar.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Daftar user tenant HotClip</caption>
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  <th scope="col" className="px-4 py-3 font-semibold">Email</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Role</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Created</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const suspended = row.status !== 'active';
                  return (
                    <tr key={row.id} className="border-b border-[var(--border)] last:border-b-0 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono text-xs">{row.email}</td>
                      <td className="px-4 py-3">{row.role}</td>
                      <td className={`px-4 py-3 font-semibold ${statusTone(row.status)}`}>{row.status}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{fmtDate(row)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {suspended ? (
                            <button
                              type="button"
                              aria-label={`Unban ${row.email}`}
                              onClick={() => setPending({ kind: 'unban', user: row })}
                              className="h-8 rounded-[var(--radius-md)] border border-[var(--border-strong)] px-3 text-xs transition-colors hover:border-[var(--success)] hover:text-[var(--success)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                            >
                              Unban
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Ban ${row.email}`}
                              onClick={() => setPending({ kind: 'ban', user: row })}
                              className="h-8 rounded-[var(--radius-md)] border border-[var(--border-strong)] px-3 text-xs transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                            >
                              Ban
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`Reset quota ${row.email}`}
                            onClick={() => setPending({ kind: 'reset-quota', user: row })}
                            className="h-8 rounded-[var(--radius-md)] border border-[var(--border-strong)] px-3 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                          >
                            Reset quota
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={pending !== null}
        pending={busy}
        tone={pending?.kind === 'ban' ? 'danger' : 'default'}
        title={
          pending?.kind === 'ban'
            ? `Ban ${pending.user.email}?`
            : pending?.kind === 'unban'
              ? `Unban ${pending.user.email}?`
              : `Reset quota ${pending?.user.email ?? ''}?`
        }
        description={
          pending?.kind === 'ban'
            ? 'User tidak akan bisa login atau membuat job baru sampai di-unban.'
            : pending?.kind === 'unban'
              ? 'User akan langsung bisa login kembali.'
              : 'Saldo credits user akan direset menjadi 0.'
        }
        confirmLabel={pending?.kind === 'ban' ? 'Ban user' : pending?.kind === 'unban' ? 'Unban user' : 'Reset quota'}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) void runAction(pending);
        }}
      />
    </div>
  );
}
