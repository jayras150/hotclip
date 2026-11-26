"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { apiClient } from "../../lib/api";
import {
  LayoutDashboard,
  Database,
  Server,
  RefreshCw,
  Clock,
  DollarSign,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Activity,
  Play,
  Square,
  WifiOff,
  Wifi,
  X,
  Globe,
} from "lucide-react";
import { DnsWizard } from "@/components/DnsWizard";

/* ------------------------------ admin model ----------------------------- */

interface AdminStorageProvider {
  id: string;
  name: string;
  kind: string;
  endpoint_url: string;
  region: string;
  quota_bytes: number;
  used_bytes: number;
  health: "healthy" | "degraded" | "down";
  priority: number;
  is_active: boolean;
}

interface VastInstanceRow {
  id: string;
  workspace_id: string;
  status: string;
  dph_total: number;
  gpu_ram: string;
  cpu: string;
  disk: string;
  inet_down: string;
  inet_up: string;
  reliability2: number;
  created_at: string;
}

interface DashboardApiState {
  activeProviders: number;
  totalCredits: number;
  lastBackup: string;
}

interface HealthCheckResult {
  ok: boolean;
  uptime: number;
  version: string;
}

interface HealthError {
  status?: number;
  message?: string;
}

/* ------------------------------- helpers -------------------------------- */

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: i === 0 ? 0 : 1,
  })} ${units[i]}`;
};

const maskEndpoint = (url: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname;
  if (host.length <= 4) return url;
  const masked = `${host.slice(0, 2)}…${host.slice(-2)}`;
  const port = parsed.port;
  return `${parsed.protocol}//${masked}${port ? `:${port}` : ""}${parsed.pathname}${parsed.search}${parsed.hash}`;
};

const timeAgo = (iso: string): string => {
  const v = Date.now() - new Date(iso).getTime();
  if (v <= 0) return "now";
  const sec = Math.floor(v / 1000);
  const units: Array<[string, number]> = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, base] of units) {
    const n = Math.floor(sec / base);
    if (n >= 1) return `${n} ${unit}${n > 1 ? "s" : ""} ago`;
  }
  return "just now";
};

const fmt2 = (n: number): string => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatUptime = (totalSeconds: number): string => {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const formatCredits = (n: number): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

/* ------------------------------- sub-components ------------------------- */

interface BadgeProps {
  label: string;
  tone: "ok" | "warn" | "bad" | "neutral" | "active" | "inactive";
}

const Badge = ({ label, tone }: BadgeProps) => {
  const map: Record<typeof tone, string> = {
    ok: "badge-ok",
    warn: "badge-warn",
    bad: "badge-bad",
    neutral: "badge-neutral",
    active: "badge-active",
    inactive: "badge-inactive",
  };
  return (
    <span className={`badge ${map[tone]}`}>{label}</span>
  );
};

interface ToggleProps {
  active: boolean;
  onChange: (active: boolean) => void;
  tooltip: string;
}

const Toggle = ({ active, onChange, tooltip }: ToggleProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={active}
    title={tooltip}
    className={`btn-toggle ${active ? "active" : "inactive"}`}
    onClick={() => onChange(!active)}
  >
    <span className="btn-toggle-knob" />
  </button>
);

interface StatTileProps {
  label: string;
  value: string;
  icon: ReactNode;
  accent: string;
}

const StatTile = ({ label, value, icon, accent }: StatTileProps) => (
  <div className="stat">
    <div className="stat-icon">{icon}</div>
    <div>
      <div className="stat-value">{value}</div>
      <div className={`stat-label ${accent}`}>{label}</div>
    </div>
  </div>
);

const SkeletonRow = () => (
  <tr className="table-row skeleton-row">
    {Array.from({ length: 8 }).map((_, i) => (
      <td key={i} className="cell">
        <div className="skeleton" />
      </td>
    ))}
  </tr>
);

interface TableSectionProps {
  title: string;
  icon: ReactNode;
  actionLabel: string;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  children?: ReactNode;
}

const TableSection = ({ title, icon, actionLabel, loading, error, onRefresh, children }: TableSectionProps) => (
  <section className="card">
    <div className="section-head">
      <div className="section-head-main">
        <h2 className="section-title">
          <span className="section-icon">{icon}</span>
          {title}
        </h2>
        <div className="section-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className="btn-icon" />
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
    {error ? (
      <div className="card-msg card-err">
        <AlertTriangle className="msg-icon" />
        <div>
          <strong>Error</strong>
          <p>{error}</p>
        </div>
      </div>
    ) : loading ? (
      <div className="table-wrap">
        <div className="table">
          <div className="table-head">
            <div className="table-row">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="cell">
                  <div className="skeleton" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ) : (
      <div className="table-wrap">
        <div className="table">{children}</div>
      </div>
    )}
  </section>
);

/* ------------------------------ main page ------------------------------- */

export default function AdminPage() {
  /* ---- dashboard header ---- */
  const [dashboard, setDashboard] = useState<DashboardApiState | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  /* ---- section A: storage pool ---- */
  const [providers, setProviders] = useState<AdminStorageProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState<string | null>(null);

  /* ---- section B: vast instances ---- */
  const [vast, setVast] = useState<VastInstanceRow[]>([]);
  const [vastLoading, setVastLoading] = useState(true);
  const [vastError, setVastError] = useState<string | null>(null);

  /* ---- section C: first-run health check ---- */
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const data = await apiClient.get<DashboardApiState>("/admin");
      setDashboard(data);
    } catch (err: unknown) {
      const e = err as HealthError;
      setDashboardError(e.message ?? "Gagal memuat dashboard");
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true);
    setProvidersError(null);
    try {
      const data = await apiClient.get<AdminStorageProvider[]>("/admin/providers");
      setProviders(data);
    } catch (err: unknown) {
      const e = err as HealthError;
      setProvidersError(e.message ?? "Gagal memuat pool penyimpanan");
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  const loadVast = useCallback(async () => {
    setVastLoading(true);
    setVastError(null);
    try {
      const data = await apiClient.get<VastInstanceRow[]>("/admin/vast-instances");
      setVast(data);
    } catch (err: unknown) {
      const e = err as HealthError;
      setVastError(e.message ?? "Gagal memuat instance Vast.ai");
    } finally {
      setVastLoading(false);
    }
  }, []);

  const runHealthCheck = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    setHealth(null);
    try {
      const data = await apiClient.get<HealthCheckResult>("/api/admin/health");
      setHealth(data);
    } catch (err: unknown) {
      const e = err as HealthError;
      setHealthError(e.message ?? "Health check gagal");
    } finally {
      setHealthLoading(false);
    }
  }, []);

  /* auto-refresh section A every 10 seconds */
  useEffect(() => {
    const id = window.setInterval(() => {
      void loadProviders();
    }, 10_000);
    return () => window.clearInterval(id);
  }, [loadProviders]);

  /* ---- mutation handlers ---- */
  const refreshAll = () => {
    void loadDashboard();
    void loadProviders();
    void loadVast();
  };

  const toggleProviderActive = async (id: string, current: boolean) => {
    if (!window.confirm(current ? "Matikan penyedia penyimpanan ini?" : "Aktifkan penyedia penyimpanan ini?")) {
      return;
    }
    try {
      await apiClient.post(`/admin/providers/${encodeURIComponent(id)}/toggle`, {});
      void loadProviders();
    } catch (err: unknown) {
      const e = err as HealthError;
      window.alert(e.message ?? "Gagal mengubah status provider");
    }
  };

  const vastAction = async (id: string, action: "start" | "stop" | "cancel") => {
    const label = action === "start" ? "Mulai" : action === "stop" ? "Stop" : "Batalkan";
    if (!window.confirm(`Eksekusi aksi "${label}" pada instance ini?`)) return;
    try {
      await apiClient.post(`/admin/vast-instances/${encodeURIComponent(id)}/${action}`, {});
      void loadVast();
    } catch (err: unknown) {
      const e = err as HealthError;
      window.alert(e.message ?? "Gagal mengeksekusi aksi instance");
    }
  };

  return (
    <div className="admin-page">
      <style>{`
        :root {
          --bg: #0b0d12;
          --surface: #12141b;
          --surface-2: #181c26;
          --border: #252a36;
          --text: #e6e9ef;
          --muted: #8a92a0;
          --primary: #6366f1;
          --primary-hover: #4f52c3;
          --ok: #34d399;
          --ok-bg: #0a2a1f;
          --warn: #fbbf24;
          --warn-bg: #2a230a;
          --bad: #f87171;
          --bad-bg: #2a1515;
          --radius: 10px;
          --gap: 16px;
          --font: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font);
          font-size: 14px;
          line-height: 1.5;
        }
        .admin-page {
          max-width: 1440px;
          margin: 0 auto;
          padding: 24px 28px 64px;
        }

        /* ---------- header ---------- */
        .header {
          display: flex;
          flex-wrap: wrap;
          gap: var(--gap);
          align-items: stretch;
          margin-bottom: 24px;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 280px;
        }
        .brand-icon {
          width: 40px;
          height: 40px;
          border-radius: var(--radius);
          background: linear-gradient(135deg, var(--primary), #a78bfa);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          flex-shrink: 0;
        }
        .brand h1 {
          font-size: 22px;
          font-weight: 700;
          margin: 0;
          letter-spacing: -0.02em;
        }
        .tagline {
          margin: 2px 0 0;
          color: var(--muted);
          font-size: 12.5px;
        }
        .stats {
          display: flex;
          flex-wrap: wrap;
          gap: var(--gap);
          margin-left: auto;
          padding: 12px 16px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
        }
        .stat {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1 1 140px;
          min-width: 120px;
        }
        .stat-icon {
          width: 34px;
          height: 34px;
          border-radius: 8px;
          background: var(--surface-2);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--primary);
          flex-shrink: 0;
        }
        .stat-value {
          font-size: 19px;
          font-weight: 700;
          line-height: 1.2;
          letter-spacing: -0.01em;
        }
        .stat-label {
          font-size: 11.5px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-top: 2px;
        }
        .stat-label.accent { color: var(--ok); }

        /* ---------- cards ---------- */
        .main {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 18px 20px;
        }
        .section-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
          flex-wrap: wrap;
        }
        .section-title {
          font-size: 15px;
          font-weight: 700;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .section-icon {
          width: 26px;
          height: 26px;
          border-radius: 7px;
          background: var(--surface-2);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--primary);
        }
        .section-actions { display: flex; gap: 8px; align-items: center; }
        .section-sub {
          font-size: 12px;
          color: var(--muted);
          margin: 2px 0 8px;
        }

        /* ---------- tables ---------- */
        .table-wrap {
          overflow-x: auto;
          border: 1px solid var(--border);
          border-radius: 8px;
          max-height: 460px;
          overflow-y: auto;
        }
        .table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          min-width: 920px;
        }
        .table-head {
          display: flex;
          gap: 0;
          border-bottom: 1px solid var(--border);
          background: var(--surface-2);
          border-radius: 8px 8px 0 0;
          overflow: hidden;
        }
        .table-row {
          display: flex;
          gap: 0;
          flex-wrap: nowrap;
        }
        .cell {
          padding: 10px 12px;
          text-align: left;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .table-head .cell {
          color: var(--muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          font-weight: 600;
          background: var(--surface-2);
          position: relative;
          padding-bottom: 8px;
        }
        .table-row:nth-child(even) .cell { background: var(--surface-2); }
        .table-row:hover .cell { background: #232836; }
        .table-row .cell.sort { cursor: default; }

        .btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid var(--border);
          background: var(--surface-2);
          color: var(--text);
          padding: 7px 12px;
          border-radius: 7px;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s, opacity 0.15s;
          font-family: inherit;
        }
        .btn:hover { background: #2a3040; border-color: #3b4355; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary { background: var(--primary); border-color: var(--primary); color: #fff; }
        .btn-primary:hover { background: var(--primary-hover); }
        .btn-ghost { background: transparent; }
        .btn-sm { padding: 5px 9px; font-size: 12px; }
        .btn-icon { width: 16px; height: 16px; color: var(--text); }
        .btn-danger { color: var(--bad); }
        .btn-danger:hover { background: var(--bad-bg); border-color: var(--bad); }

        .badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 11.5px;
          font-weight: 700;
          text-transform: capitalize;
          letter-spacing: 0.02em;
        }
        .badge-ok { background: #0f3a22; color: #34d399; }
        .badge-warn { background: #4a3508; color: #fbbf24; }
        .badge-bad { background: #4a1414; color: #f87171; }
        .badge-neutral { background: #1f2430; color: #8a92a0; }
        .badge-active { background: #0f3a22; color: #34d399; }
        .badge-inactive { background: #1f2430; color: #6b7280; }

        /* ---------- toggle switch ---------- */
        .btn-toggle {
          position: relative;
          width: 40px;
          height: 22px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--surface-2);
          cursor: pointer;
          flex-shrink: 0;
          transition: background 0.15s;
        }
        .btn-toggle.active { background: #0f3a22; border-color: #34d399; }
        .btn-toggle-knob {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--muted);
          transition: transform 0.18s;
        }
        .btn-toggle.active .btn-toggle-knob { transform: translateX(18px); background: #34d399; }

        /* ---------- misc ---------- */
        .btn-group { display: flex; flex-wrap: wrap; gap: 6px; }
        .empty {
          padding: 18px 20px;
          color: var(--muted);
          font-size: 13px;
          text-align: center;
        }
        .card-msg {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          padding: 12px 14px;
          border-radius: 8px;
          font-size: 13px;
        }
        .card-err { background: var(--bad-bg); border: 1px solid var(--bad); color: #fecaca; }
        .msg-icon { color: #fca5a5; flex-shrink: 0; margin-top: 2px; }
        .alert-box {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          padding: 12px 14px;
          border-radius: 8px;
          font-size: 13px;
        }

        /* ---------- health check card ---------- */
        .health-result { border-radius: 8px; padding: 14px 16px; }
        .health-pass { background: var(--ok-bg); border: 1px solid var(--ok); color: #d1fae5; }
        .health-fail { background: var(--bad-bg); border: 1px solid var(--bad); color: #fee2e2; }
        .health-checks { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .health-checks li { display: flex; gap: 8px; align-items: flex-start; }
        .health-checks .dot { flex-shrink: 0; margin-top: 3px; }
        .health-checks .row { min-width: 0; }
        .health-checks .row .name { font-weight: 600; }
        .health-checks .row .detail { color: var(--muted); font-size: 12px; }
        .health-checks .dot.ok { color: var(--ok); }
        .health-checks .dot.bad { color: var(--bad); }

        /* ---------- skeleton ---------- */
        .skeleton {
          height: 12px;
          border-radius: 4px;
          background: linear-gradient(90deg, var(--surface-2) 25%, #252a36 50%, var(--surface-2) 75%);
          background-size: 200% 100%;
          animation: shimmer 1.4s infinite;
        }
        @keyframes shimmer { to { background-position: -200% 0; } }
        .skeleton-row .cell { padding: 10px 12px; }

        /* ---------- footer ---------- */
        .footer {
          margin-top: 24px;
          text-align: center;
          font-size: 12px;
          color: var(--muted);
        }
      `}</style>

      <header className="header">
        <div className="brand">
          <div className="brand-icon">
            <LayoutDashboard />
          </div>
          <div>
            <h1>Admin Pool</h1>
            <p className="tagline">Multi-provider S3 pool · Vast.ai instances · first-run health</p>
          </div>
        </div>
        <div className="stats">
          <StatTile
            label="Active providers"
            value={formatCredits(dashboard?.activeProviders ?? 0)}
            accent="accent"
            icon={<Database />}
          />
          <StatTile
            label="Total credits"
            value={dashboard ? formatCredits(dashboard.totalCredits) : "…"}
            accent=""
            icon={<DollarSign />}
          />
          <StatTile
            label="Last backup"
            value={dashboard ? timeAgo(dashboard.lastBackup) : "…"}
            accent=""
            icon={<Clock />}
          />
        </div>
      </header>

      <nav aria-label="Admin sections" style={{ display: "flex", gap: 12, margin: "16px 0 0" }}>
        <a href="/admin" className="btn" style={{ textDecoration: "none" }}>Dashboard</a>
        <a href="/admin/users" className="btn" style={{ textDecoration: "none" }}>Users</a>
        <a href="/admin/audit" className="btn" style={{ textDecoration: "none" }}>Audit Logs</a>
      </nav>

      <main className="main">
        {/* ================= Section A ================= */}
        <TableSection
          title="Storage Pool"
          icon={<Database />}
          actionLabel="Refresh"
          loading={providersLoading}
          error={providersError}
          onRefresh={() => { void loadProviders(); }}
        >
          <div className="table-head">
            <div className="table-row">
              <div className="cell">ID</div>
              <div className="cell">Name</div>
              <div className="cell">Kind</div>
              <div className="cell">Endpoint</div>
              <div className="cell">Region</div>
              <div className="cell">Quota</div>
              <div className="cell">Used</div>
              <div className="cell">Health</div>
              <div className="cell">Priority</div>
              <div className="cell">Active</div>
              <div className="cell">Action</div>
            </div>
          </div>
          {providers.map((p: AdminStorageProvider) => (
            <div key={p.id} className="table-row">
              <div className="cell">{p.id}</div>
              <div className="cell">{p.name}</div>
              <div className="cell">{p.kind}</div>
              <div className="cell">{maskEndpoint(p.endpoint_url) || "—"}</div>
              <div className="cell">{p.region || "—"}</div>
              <div className="cell">{formatBytes(p.quota_bytes)}</div>
              <div className="cell">{formatBytes(p.used_bytes)}</div>
              <div className="cell"><Badge tone={p.health === "down" ? "bad" : p.health === "degraded" ? "warn" : "ok"} label={p.health} /></div>
              <div className="cell">{p.priority}</div>
              <div className="cell">
                <Toggle
                  active={p.is_active}
                  onChange={() => void toggleProviderActive(p.id, p.is_active)}
                  tooltip={p.is_active ? "Deaktifkan penyedia ini" : "Aktifkan penyedia ini"}
                />
              </div>
              <div className="cell">
                <Badge tone={p.is_active ? "active" : "inactive"} label={p.is_active ? "Active" : "Inactive"} />
              </div>
            </div>
          ))}
          {!providersLoading && providers.length === 0 && (
            <div className="empty">Tidak ada penyedia penyimpanan.</div>
          )}
        </TableSection>

        {/* ================= Section B ================= */}
        <TableSection
          title="Active Vast.ai Instances"
          icon={<Server />}
          actionLabel="Refresh"
          loading={vastLoading}
          error={vastError}
          onRefresh={() => { void loadVast(); }}
        >
          <div className="table-head">
            <div className="table-row">
              <div className="cell">ID</div>
              <div className="cell">Workspace</div>
              <div className="cell">Status</div>
              <div className="cell">Price</div>
              <div className="cell">GPU RAM</div>
              <div className="cell">CPU</div>
              <div className="cell">Disk</div>
              <div className="cell">Inet Down</div>
              <div className="cell">Inet Up</div>
              <div className="cell">Reliability</div>
              <div className="cell">Created</div>
              <div className="cell">Actions</div>
            </div>
          </div>
          {vast.map((v: VastInstanceRow) => (
            <div key={v.id} className="table-row">
              <div className="cell">{v.id}</div>
              <div className="cell">{v.workspace_id}</div>
              <div className="cell"><Badge tone="neutral" label={v.status} /></div>
              <div className="cell">{fmt2(v.dph_total)}</div>
              <div className="cell">{v.gpu_ram}</div>
              <div className="cell">{v.cpu}</div>
              <div className="cell">{v.disk}</div>
              <div className="cell"><WifiOff className="dot" />{v.inet_down}</div>
              <div className="cell"><Wifi className="dot" />{v.inet_up}</div>
              <div className="cell">{(v.reliability2 * 100).toFixed(1)}%</div>
              <div className="cell">{timeAgo(v.created_at)}</div>
              <div className="cell">
                <ButtonGroup>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    title="Start"
                    onClick={() => void vastAction(v.id, "start")}
                  >
                    <Play />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon btn-danger"
                    title="Stop"
                    onClick={() => void vastAction(v.id, "stop")}
                  >
                    <Square />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon btn-danger"
                    title="Cancel"
                    onClick={() => void vastAction(v.id, "cancel")}
                  >
                    <X />
                  </button>
                </ButtonGroup>
              </div>
            </div>
          ))}
          {!vastLoading && vast.length === 0 && (
            <div className="empty">Tidak ada instance Vast.ai.</div>
          )}
        </TableSection>

        {/* ================= Section C ================= */}
        <section className="card">
          <div className="section-head">
            <div className="section-head-main">
              <h2 className="section-title">
                <span className="section-icon">
                  <Activity />
                </span>
                First-run Health Check
              </h2>
            </div>
          </div>
          <div className="section-sub">Autentikasi lingkungan pada mulai pertama; pandu ke layanan yang diperlukan.</div>
          <div className="btn-group">
            <button
              type="button"
              className="btn btn-primary"
              onClick={runHealthCheck}
              disabled={healthLoading}
            >
              {healthLoading ? (
                <>
                  <RefreshCw className="btn-icon" />
                  Checking…
                </>
              ) : (
                <>
                  <CheckCircle className="btn-icon" />
                  Run Check
                </>
              )}
            </button>
          </div>

          {healthError ? (
            <div className="alert-box health-result">
              <AlertTriangle className="dot" />
              <div>
                <strong>Health check gagal</strong>
                <p>{healthError}</p>
              </div>
            </div>
          ) : health ? (
            <div className={`health-result health-${health.ok ? "pass" : "fail"}`}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>
                    {health.ok ? "Environment ready" : "Health check failed"}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
                    Uptime <strong>{formatUptime(health.uptime)}</strong> · Version{" "}
                    <strong>{health.version || "—"}</strong>
                  </div>
                </div>
                <Badge tone={health.ok ? "ok" : "bad"} label={health.ok ? "Pass" : "Fail"} />
              </div>
              <ul className="health-checks">
                <li>
                  <span className={`dot ${health.ok ? "ok" : "bad"}`}>
                    {health.ok ? <CheckCircle /> : <XCircle />}
                  </span>
                  <div className="row">
                    <div className="name">Service status</div>
                    <div className="detail">{health.ok ? "Operational" : "Down"}</div>
                  </div>
                </li>
                <li>
                  <span className={`dot ${health.uptime >= 0 ? "ok" : "bad"}`}>
                    <Clock />
                  </span>
                  <div className="row">
                    <div className="name">Uptime</div>
                    <div className="detail">{formatUptime(health.uptime)}</div>
                  </div>
                </li>
                <li>
                  <span className={`dot ${health.version ? "ok" : "bad"}`}>
                    {health.version ? <CheckCircle /> : <XCircle />}
                  </span>
                  <div className="row">
                    <div className="name">Version</div>
                    <div className="detail">{health.version || "—"}</div>
                  </div>
                </li>
              </ul>
            </div>
          ) : null}
        </section>

        {/* ================= Section D ================= */}
        <section className="card">
          <div className="section-head">
            <div className="section-head-main">
              <h2 className="section-title">
                <span className="section-icon">
                  <Globe />
                </span>
                DNS Setup Wizard
              </h2>
            </div>
          </div>
          <div className="section-sub">
            Arahkan domain ke IP VPS, verifikasi propagasi, lalu selesaikan checklist SSL.
          </div>
          <DnsWizard />
        </section>
      </main>

      <footer className="footer">
        Data tabel otomatis diperbarui setiap 10 detik · {dashboard?.activeProviders ?? 0} provider aktif · last backup {dashboard?.lastBackup ?? "—"}
      </footer>
    </div>
  );
}

const ButtonGroup = ({ children }: { children?: ReactNode }) => (
  <div className="btn-group">{children}</div>
);
