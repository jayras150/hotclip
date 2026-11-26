"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient, ApiError } from "@/lib/api";
import { TopupDialog } from "@/components/TopupDialog";
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
  const [wallet, setWallet] = useState<WalletPayload | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topupOpen, setTopupOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [walletPayload, topupPayload] = await Promise.all([
        apiClient.get<unknown>(WALLET_URL),
        apiClient.get<unknown>(TOPUPS_URL),
      ]);
      setWallet(normalizeWallet(walletPayload));
      setTransactions(normalizeTransactions(topupPayload));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const credits = wallet?.credits_balance ?? 0;
  const currency = (wallet?.currency_code ?? "IDR").toUpperCase();
  const exchangeRate = wallet?.exchange_rate ?? 15000;
  const localBalance = wallet?.local_balance ?? credits * exchangeRate;
  const hasLowBalance = wallet !== null && credits < LOW_BALANCE_THRESHOLD;
  const isWalletActive = wallet?.is_active ?? true;

  return (
    <div className="min-h-screen bg-[#0a0b0f] font-sans text-[#f3f4f8]">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#ff4d2e] to-[#ff9a3d] shadow-lg shadow-[#ff4d2e]/20">
              <CreditCard className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Billing</h1>
              <p className="text-sm text-[#8f95a3]">Wallet kredit &amp; riwayat transaksi</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isWalletActive ? (
              <span className="flex items-center gap-2 text-sm text-[#8f95a3]">
                <ShieldCheck className="h-4 w-4" />
                Aktif
              </span>
            ) : (
              <span className="text-sm text-red-400">Inactive</span>
            )}
            <button
              type="button"
              onClick={() => setTopupOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#ff4d2e] to-[#ff9a3d] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#ff4d2e]/20 transition hover:scale-[1.02] active:scale-95"
            >
              <CurrencyDollar className="h-4 w-4" />
              Top Up
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="text-xs font-semibold underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        )}

        {/* Wallet summary cards */}
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-[#262a35] bg-[#12141a] p-5">
            <div className="mb-2 flex items-center gap-3">
              <Wallet className="h-5 w-5 text-[#ff4d2e]" />
              <span className="text-sm text-[#8f95a3]">Kredit aktif</span>
            </div>
            <p className="text-3xl font-bold tracking-tight">
              {loading && !wallet ? "—" : formatCredits(credits)}
            </p>
            <p className="mt-1 text-xs text-[#8f95a3]">{currency} kredit tersedia</p>
          </div>

          <div className="rounded-2xl border border-[#262a35] bg-[#12141a] p-5">
            <div className="mb-2 flex items-center gap-3">
              <CurrencyDollar className="h-5 w-5 text-[#ff9a3d]" />
              <span className="text-sm text-[#8f95a3]">Saldo lokal</span>
            </div>
            <p className="text-3xl font-bold tracking-tight">
              {loading && !wallet ? "—" : formatLocalAmount(localBalance, currency)}
            </p>
            <p className="mt-1 text-xs text-[#8f95a3]">{currency} total</p>
          </div>

          <div className="rounded-2xl border border-[#262a35] bg-[#12141a] p-5">
            <div className="mb-2 flex items-center gap-3">
              <TrendingUp className="h-5 w-5 text-[#ff4d2e]" />
              <span className="text-sm text-[#8f95a3]">Kurs</span>
            </div>
            <p className="text-3xl font-bold tracking-tight">
              1 = {formatCredits(exchangeRate)}
            </p>
            <p className="mt-1 text-xs text-[#8f95a3]">
              1 kredit = {exchangeRate.toLocaleString()} {currency}
            </p>
          </div>
        </div>

        {/* Low balance warning + top-up packages */}
        {hasLowBalance && (
          <div className="mb-6 rounded-2xl border border-[#ff4d2e]/30 bg-[#1a0f0a] p-5">
            <div className="flex items-start gap-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-[#ff4d2e]" />
              <div className="flex-1">
                <h2 className="mb-1 text-lg font-bold text-[#ff4d2e]">Saldo rendah</h2>
                <p className="mb-4 text-sm text-[#8f95a3]">
                  Sisa kredit {formatCredits(credits)} &lt; {LOW_BALANCE_THRESHOLD} kredit.
                  Pastikan top-up untuk menjaga keberlangsungan pekerjaan.
                </p>
                <div className="flex flex-wrap gap-3">
                  {PACKAGES.map((pkg) => (
                    <button
                      key={pkg.label}
                      type="button"
                      className="flex items-center gap-2 rounded-xl border border-[#262a35] bg-[#191c24] px-4 py-2.5 text-sm font-medium transition hover:border-[#ff4d2e]/50 hover:bg-[#12141a] focus:outline-none focus:ring-2 focus:ring-[#ff4d2e]/40"
                      onClick={() => setTopupOpen(true)}
                    >
                      <Banknote className="h-4 w-4 text-[#ff9a3d]" />
                      {pkg.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Transactions table */}
        <div className="overflow-hidden rounded-2xl border border-[#262a35] bg-[#12141a]">
          <div className="flex items-center justify-between border-b border-[#262a35] px-5 py-4">
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-[#8f95a3]" />
              <h2 className="text-lg font-bold">Riwayat transaksi</h2>
              <span className="text-sm text-[#8f95a3]">({transactions.length})</span>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-2 text-sm text-[#8f95a3] transition hover:text-[#ff4d2e]"
            >
              {loading ? (
                <Loader className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Muat ulang
            </button>
          </div>

          {loading && transactions.length === 0 ? (
            <div className="space-y-3 px-5 py-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-[#191c24]" />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-[#8f95a3]">
                Belum ada transaksi. Top-up untuk menambah kredit.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#262a35]">
                    <th className="px-5 py-3 text-left font-semibold text-[#8f95a3]">Tanggal</th>
                    <th className="px-5 py-3 text-right font-semibold text-[#8f95a3]">Jumlah</th>
                    <th className="px-5 py-3 text-right font-semibold text-[#8f95a3]">Kredit</th>
                    <th className="px-5 py-3 text-left font-semibold text-[#8f95a3]">Gateway</th>
                    <th className="px-5 py-3 text-left font-semibold text-[#8f95a3]">Status</th>
                    <th className="px-5 py-3 text-right font-semibold text-[#8f95a3]">
                      Eksternal ID
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx: TransactionRow) => (
                    <tr
                      key={tx.id}
                      className="border-b border-[#1e222b] transition hover:bg-[#191c24]"
                    >
                      <td className="px-5 py-3 text-[#f3f4f8]">{formatDate(tx.date)}</td>
                      <td className="px-5 py-3 text-right font-medium text-[#f3f4f8]">
                        {formatLocalAmount(tx.amountLocal, tx.currency_code)}
                      </td>
                      <td className="px-5 py-3 text-right text-[#8f95a3]">
                        {tx.credits_added > 0 ? `+${formatCredits(tx.credits_added)}` : "—"}
                      </td>
                      <td className="px-5 py-3 capitalize text-[#f3f4f8]">{tx.gateway}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={tx.status} />
                      </td>
                      <td className="px-5 py-3 text-right text-xs text-[#8f95a3]">
                        {tx.external_tx_id ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="mt-6 text-center text-xs text-[#8f95a3]">
          1 kredit = {exchangeRate.toLocaleString()} {currency}
          &nbsp;·&nbsp; Top-up via Midtrans / Xendit / Tripay / Manual
        </div>
      </div>

      {/* Top-up dialog (controlled) */}
      <TopupDialog
        open={topupOpen}
        onOpenChange={setTopupOpen}
        onSuccess={() => {
          void load();
        }}
      />
    </div>
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
        "inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-400",
    },
    settled: {
      label: "Settled",
      className:
        "inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400",
    },
    failed: {
      label: "Failed",
      className:
        "inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-400",
    },
    refunded: {
      label: "Refunded",
      className:
        "inline-flex items-center gap-1.5 rounded-full bg-slate-500/10 px-2.5 py-0.5 text-xs font-semibold text-slate-400",
    },
  } as const;

  const { label, className } = config[status];
  return (
    <span className={className}>
      {status === "pending" && <Clock className="h-3 w-3" />}
      {status === "settled" && <CheckCircle className="h-3 w-3" />}
      {status === "failed" && <X className="h-3 w-3" />}
      {status === "refunded" && <ArrowRight className="h-3 w-3" />}
      {label}
    </span>
  );
}
