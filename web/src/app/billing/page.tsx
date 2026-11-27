"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient, ApiError } from "@/lib/api";
import { TopupDialog } from "@/components/TopupDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { clerkEnabled } from "@/lib/clerk";
import {
  useClerkWalletAuth,
} from "@/lib/hooks/use-wallet-balance";
import { SIGNED_OUT_WALLET_AUTH, type WalletAuth } from "@/lib/wallet-balance";
import {
  CreditCard,
  Wallet,
  TrendingUp,
  ArrowRight,
  CheckCircle,
  Clock,
  X,
  Loader,
  CircleDollarSign as CurrencyDollar,
  Banknote,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  Sparkles,
  Plus,
} from "lucide-react";

/* ==========================================================================
 * Types
 * ========================================================================== */

/** Wallet payload (API shape). */
export interface WalletPayload {
  userId: string;
  credits_balance: number;
  local_balance: number;
  currency_code: string;
  exchange_rate: number;
  is_active: boolean;
}

type TransactionStatus = "pending" | "settled" | "failed" | "refunded";

/** Screen transaction row. */
export interface TransactionRow {
  id: string;
  date?: string;
  amountLocal: number;
  currency_code: string;
  credits_added: number;
  gateway: string;
  status: TransactionStatus;
  external_tx_id?: string;
}

const WALLET_URL = "/api/v1/wallet/balance";
const TOPUPS_URL = "/api/v1/topups";
const LOW_BALANCE_THRESHOLD = 100;

const PACKAGES: { label: string; amountLocal: number; currency: string }[] = [
  { label: "10k IDR", amountLocal: 10000, currency: "IDR" },
  { label: "50k IDR", amountLocal: 50000, currency: "IDR" },
  { label: "100 USD", amountLocal: 100, currency: "USD" },
];

/* ==========================================================================
 * Helpers
 * ========================================================================== */

/** Envelope-tolerant: accepts `{ ok, data }`, `{ data }`, or a raw value. */
function unwrap<T>(payload: unknown): T {
  if (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "data" in (payload as Record<string, unknown>)
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function errorMessage(err: unknown): string {
  const apiErr = err as ApiError;
  if (apiErr instanceof ApiError) return apiErr.message || "Request failed";
  if (err instanceof Error) return err.message;
  return "Gagal memuat data billing.";
}

function asNumber(value: unknown, fallback = 0): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Format a local-currency amount for display (IDR/USD automatically). */
function formatLocalAmount(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  try {
    switch (code) {
      case "IDR":
        return new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(amount);
      case "USD":
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(amount);
      default:
        return `${new Intl.NumberFormat("id-ID", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(amount)} ${code}`;
    }
  } catch {
    return `${amount.toLocaleString()} ${code}`;
  }
}

/** Format a credit amount (raw number with thousands separator). */
function formatCredits(amount: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(amount);
}

/** Format a date string to a locale-friendly short date. */
function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeWallet(payload: unknown): WalletPayload | null {
  const raw = unwrap<unknown>(payload);
  if (!isRecord(raw)) return null;
  const exchangeRate = asNumber(raw.exchange_rate ?? raw.exchangeRate, 15000);
  const credits = asNumber(raw.credits_balance ?? raw.creditsBalance ?? raw.balance, 0);
  return {
    userId: asString(raw.userId ?? raw.user_id),
    credits_balance: credits,
    local_balance: asNumber(
      raw.local_balance ?? raw.localBalance,
      credits * exchangeRate,
    ),
    currency_code: asString(raw.currency_code ?? raw.currencyCode ?? raw.currency, "IDR"),
    exchange_rate: exchangeRate,
    is_active: typeof raw.is_active === "boolean" ? raw.is_active : true,
  };
}

function normalizeStatus(value: unknown): TransactionStatus {
  const status = asString(value, "pending").toLowerCase();
  if (status === "completed" || status === "settled" || status === "success") return "settled";
  if (status === "failed" || status === "expired" || status === "cancelled") return "failed";
  if (status === "refunded") return "refunded";
  return "pending";
}

function normalizeTransactions(payload: unknown): TransactionRow[] {
  const data = unwrap<unknown>(payload);
  if (!Array.isArray(data)) return [];
  return data
    .filter(isRecord)
    .map((raw) => ({
      id: asString(raw.id),
      date: asString(raw.createdAt ?? raw.created_at ?? raw.date) || undefined,
      amountLocal: asNumber(raw.amountLocal ?? raw.amount_local ?? raw.amount, 0),
      currency_code: asString(raw.currency ?? raw.currency_code, "IDR").toUpperCase(),
      credits_added: asNumber(raw.creditsAdded ?? raw.credits_added, 0),
      gateway: asString(raw.gateway, "manual"),
      status: normalizeStatus(raw.status),
      external_tx_id:
        asString(raw.externalTxId ?? raw.external_tx_id ?? raw.referenceId) || undefined,
    }))
    .filter((row) => row.id.length > 0);
}

/* ==========================================================================
 * Page
 * ========================================================================== */

export default function BillingPage() {
  // Without a publishable key there is no ClerkProvider and `useAuth()` would
  // throw on the server. The screen is still rendered, but as an unsigned view.
  if (!clerkEnabled) {
    return <BillingView auth={SIGNED_OUT_WALLET_AUTH} />;
  }
  return <BillingViewClerk />;

  function BillingViewClerk() {
    const auth = useClerkWalletAuth();
    return <BillingView auth={auth} />;
  }
}

interface BillingViewProps {
  auth: WalletAuth;
}

function BillingView({ auth }: BillingViewProps) {
  const [wallet, setWallet] = useState<WalletPayload | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topupOpen, setTopupOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const token = await auth.getToken();
      if (!token) {
        // Signed out: leave the previous view untouched instead of firing an
        // unauthenticated /api/v1/wallet/balance request (which would
        // return 500 and spam the console).
        return;
      }
      const [walletPayload, topupPayload] = await Promise.all([
        apiClient.get<unknown>(WALLET_URL, { headers: { Authorization: `Bearer ${token}` } }),
        apiClient.get<unknown>(TOPUPS_URL, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setWallet(normalizeWallet(walletPayload));
      setTransactions(normalizeTransactions(topupPayload));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    // Never fire before Clerk resolves the session — a request without
    // `isLoaded && isSignedIn` would hit the API as anonymous and return 500.
    if (!auth.isLoaded || !auth.isSignedIn) return;
    void load();
  }, [auth, load]);

  const credits = wallet?.credits_balance ?? 0;
  const currency = (wallet?.currency_code ?? "IDR").toUpperCase();
  const exchangeRate = wallet?.exchange_rate ?? 15000;
  const localBalance = wallet?.local_balance ?? credits * exchangeRate;
  const hasLowBalance = wallet !== null && credits < LOW_BALANCE_THRESHOLD;
  const isWalletActive = wallet?.is_active ?? true;

  return (
    <div className="min-h-screen bg-bg font-sans text-text">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,var(--glow-soft)_0%,transparent_70%)]"
      />
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-[var(--border-accent-soft)] bg-surface-2 shadow-[var(--shadow-glow)]">
              <CreditCard className="size-5 text-accent" aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-text">
                Billing
              </h1>
              <p className="text-sm text-text-muted">Wallet credits &amp; transaction history</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isWalletActive ? (
              <span className="flex items-center gap-1.5 rounded-full border border-[var(--border-accent-soft)] bg-surface px-3 py-1.5 text-xs font-medium text-text-muted">
                <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
                Aktif
              </span>
            ) : (
              <span className="rounded-full border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger">
                Inactive
              </span>
            )}
            <button
              type="button"
              onClick={() => setTopupOpen(true)}
              className="group flex items-center gap-2 rounded-xl bg-[var(--gradient-accent)] px-4 py-2.5 text-sm font-semibold text-[#06080d] shadow-[var(--shadow-glow)] transition-all duration-200 hover:shadow-[var(--shadow-glow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-[0.97] motion-reduce:transition-none motion-reduce:hover:shadow-[var(--shadow-glow)]"
            >
              <Plus className="size-4 transition-transform duration-200 group-hover:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
              Top Up
            </button>
          </div>
        </header>

        {error && (
          <div
            role="alert"
            className="mb-6 flex items-center gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          >
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md text-xs font-semibold underline underline-offset-2 transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60"
            >
              Retry
            </button>
          </div>
        )}

        {/* Balance hero */}
        <section className="relative mb-8 overflow-hidden rounded-2xl border border-[var(--border)] bg-surface p-6 shadow-[var(--shadow-card)] sm:p-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-[var(--gradient-radial-glow)] opacity-60"
          />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-text-muted">
                <Wallet className="size-3.5 text-accent" aria-hidden="true" />
                Credits
              </p>
              {loading && !wallet ? (
                <Skeleton className="h-12 w-56" />
              ) : (
                <p
                  className="font-[family-name:var(--font-display)] text-5xl font-semibold tracking-tight text-text tabular-nums sm:text-6xl"
                  style={{ textShadow: "0 0 32px var(--glow-soft)" }}
                >
                  {formatCredits(credits)}
                  <span className="ml-2 align-middle text-base font-medium text-text-muted">
                    {currency} credits
                  </span>
                </p>
              )}
              <p className="mt-3 text-sm text-text-muted">
                {loading && !wallet ? (
                  <Skeleton className="inline-block h-4 w-40 align-middle" />
                ) : (
                  <>
                    Setara{" "}
                    <span className="font-medium text-accent tabular-nums">
                      {formatLocalAmount(localBalance, currency)}
                    </span>{" "}
                    · 1 credit = {exchangeRate.toLocaleString()} {currency}
                  </>
                )}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-1">
              <div className="rounded-xl border border-[var(--border)] bg-surface-2 px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs text-text-muted">
                  <TrendingUp className="size-3.5 text-accent" aria-hidden="true" />
                  Kurs
                </p>
                <p className="mt-0.5 font-[family-name:var(--font-display)] text-lg font-semibold text-text tabular-nums">
                  1 = {formatCredits(exchangeRate)}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-surface-2 px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs text-text-muted">
                  <CurrencyDollar className="size-3.5 text-accent" aria-hidden="true" />
                  Transactions
                </p>
                <p className="mt-0.5 font-[family-name:var(--font-display)] text-lg font-semibold text-text tabular-nums">
                  {transactions.length}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Low balance warning + top-up packages */}
        {hasLowBalance && (
          <div className="mb-8 rounded-2xl border border-warning/30 bg-warning/[0.06] p-5">
            <div className="flex items-start gap-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-warning/30 bg-warning/10">
                <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
              </span>
              <div className="flex-1">
                <h2 className="mb-1 font-[family-name:var(--font-display)] text-base font-semibold text-warning">
                  Low balance
                </h2>
                <p className="mb-4 text-sm text-text-muted">
                  Remaining credits {formatCredits(credits)} &lt; {LOW_BALANCE_THRESHOLD} credits.
                  Pastikan top-up untuk menjaga keberlangsungan pekerjaan.
                </p>
                <div className="flex flex-wrap gap-2.5">
                  {PACKAGES.map((pkg) => (
                    <button
                      key={pkg.label}
                      type="button"
                      className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-surface-2 px-4 py-2.5 text-sm font-medium text-text tabular-nums transition-all duration-200 hover:border-[var(--border-accent)] hover:shadow-[var(--shadow-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.97] motion-reduce:transition-none"
                      onClick={() => setTopupOpen(true)}
                    >
                      <Banknote className="size-4 text-accent" aria-hidden="true" />
                      {pkg.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Transactions */}
        <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-surface shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <div className="flex items-center gap-2.5">
              <Clock className="size-4 text-text-muted" aria-hidden="true" />
              <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-text">
                Riwayat transaksi
              </h2>
              <span className="rounded-full border border-[var(--border)] bg-surface-2 px-2 py-0.5 text-xs text-text-muted tabular-nums">
                {transactions.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-text-muted transition-colors duration-200 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {loading ? (
                <Loader className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
              Muat ulang
            </button>
          </div>

          {loading && transactions.length === 0 ? (
            <div className="space-y-3 px-5 py-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-36" />
                  <Skeleton className="h-10 flex-1" />
                  <Skeleton className="h-10 w-24" />
                </div>
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl border border-[var(--border)] bg-surface-2">
                <Wallet className="size-5 text-text-muted" aria-hidden="true" />
              </span>
              <p className="text-sm text-text-muted">
                No transactions yet. Top up to add credits.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      {["Tanggal", "Jumlah", "Kredit", "Gateway", "Status", "Eksternal ID"].map(
                        (h, i) => (
                          <th
                            key={h}
                            className={`px-5 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted ${
                              i === 1 || i === 2 || i === 5 ? "text-right" : "text-left"
                            }`}
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx: TransactionRow) => (
                      <tr
                        key={tx.id}
                        className="border-b border-[var(--border)] transition-colors duration-150 last:border-b-0 hover:bg-white/[0.03]"
                      >
                        <td className="whitespace-nowrap px-5 py-3.5 text-text tabular-nums">
                          {formatDate(tx.date)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-right font-medium text-text tabular-nums">
                          {formatLocalAmount(tx.amountLocal, tx.currency_code)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <TypeBadge row={tx} />
                            <span
                              className={`font-medium tabular-nums ${
                                tx.credits_added > 0 ? "text-success" : "text-text-muted"
                              }`}
                            >
                              {tx.credits_added > 0
                                ? `+${formatCredits(tx.credits_added)}`
                                : "—"}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 capitalize text-text">{tx.gateway}</td>
                        <td className="px-5 py-3.5">
                          <StatusBadge status={tx.status} />
                        </td>
                        <td className="max-w-[180px] truncate px-5 py-3.5 text-right font-mono text-xs text-[var(--text-faint)]">
                          {tx.external_tx_id ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile stacked cards */}
              <ul className="divide-y divide-[var(--border)] md:hidden">
                {transactions.map((tx: TransactionRow) => (
                  <li key={tx.id} className="px-5 py-4 transition-colors duration-150 hover:bg-white/[0.03]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text tabular-nums">
                          {formatLocalAmount(tx.amountLocal, tx.currency_code)}
                        </p>
                        <p className="mt-0.5 text-xs text-text-muted tabular-nums">
                          {formatDate(tx.date)}
                        </p>
                      </div>
                      <StatusBadge status={tx.status} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                      <TypeBadge row={tx} />
                      <span className="capitalize text-text-muted">{tx.gateway}</span>
                      {tx.credits_added > 0 && (
                        <span className="font-medium text-success tabular-nums">
                          +{formatCredits(tx.credits_added)} credits
                        </span>
                      )}
                      {tx.external_tx_id && (
                        <span className="truncate font-mono text-[var(--text-faint)]">
                          {tx.external_tx_id}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* Footer note */}
        <p className="mt-6 text-center text-xs text-[var(--text-faint)]">
          1 credit = {exchangeRate.toLocaleString()} {currency}
          &nbsp;·&nbsp; Top-up via Midtrans / Xendit / Tripay / Manual
        </p>
      </div>

      {/* Top-up dialog (controlled) */}
      <TopupDialog
        open={topupOpen}
        onOpenChange={setTopupOpen}
        onSuccess={() => {
          void load();
        }}
        auth={auth}
      />
    </div>
  );
}

/** Transaction type badge: top-up (credits added) = emerald, usage = neutral/cyan. */
function TypeBadge({ row }: { row: TransactionRow }) {
  if (row.credits_added > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
        <Plus className="size-3" aria-hidden="true" />
        Top-up
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
      <Sparkles className="size-3" aria-hidden="true" />
      Pemakaian
    </span>
  );
}

/* ==========================================================================
 * Status badge
 * ========================================================================== */

function StatusBadge({ status }: { status: TransactionStatus }) {
  const config = {
    pending: {
      label: "Pending",
      className:
        "inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning",
    },
    settled: {
      label: "Settled",
      className:
        "inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success",
    },
    failed: {
      label: "Failed",
      className:
        "inline-flex items-center gap-1.5 rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-semibold text-danger",
    },
    refunded: {
      label: "Refunded",
      className:
        "inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-text-muted",
    },
  } as const;

  const { label, className } = config[status];
  return (
    <span className={className}>
      {status === "pending" && <Clock className="size-3" aria-hidden="true" />}
      {status === "settled" && <CheckCircle className="size-3" aria-hidden="true" />}
      {status === "failed" && <X className="size-3" aria-hidden="true" />}
      {status === "refunded" && <ArrowRight className="size-3" aria-hidden="true" />}
      {label}
    </span>
  );
}
