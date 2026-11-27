"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CreditCard,
  CheckCircle,
  Loader,
  CircleDollarSign as CurrencyDollar,
  Banknote,
  AlertTriangle,
  Wallet,
  Sparkles,
  Zap,
  Rocket,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/cn";

/* ==========================================================================
 * Types
 * ========================================================================== */

type CurrencyCode = "IDR" | "USD" | "JPY" | "TRY" | "VND" | "MYR" | "THB";
type Gateway = "midtrans" | "xendit" | "tripay" | "manual";
type TopupStatus = "idle" | "loading" | "success" | "error";

interface FormState {
  amountLocal: string;
  currencyCode: CurrencyCode;
  gateway: Gateway;
}

interface ToastState {
  visible: boolean;
  message: string;
  type: "success" | "error";
}

export interface TopupDialogProps {
  /** Controlled open state. When omitted, the dialog manages its own state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called after a successful top-up so the parent can refresh the wallet. */
  onSuccess?: () => void;
}

interface TopupResponse {
  txId?: string;
  id?: string;
  status?: string;
}

/* ==========================================================================
 * Constants
 * ========================================================================== */

const CURRENCY_OPTIONS: CurrencyCode[] = ["IDR", "USD", "JPY", "TRY", "VND", "MYR", "THB"];

const GATEWAYS: { value: Gateway; label: string; hint: string }[] = [
  { value: "midtrans", label: "Midtrans", hint: "Midtrans Payment Gateway" },
  { value: "xendit", label: "Xendit", hint: "Xendit Payment Gateway" },
  { value: "tripay", label: "Tripay", hint: "Tripay Payment Gateway" },
  { value: "manual", label: "Manual", hint: "Manual bank transfer" },
];

const DEFAULT_EXCHANGE_RATES: Record<CurrencyCode, number> = {
  IDR: 15000,
  USD: 15000,
  JPY: 150,
  TRY: 450,
  VND: 100,
  MYR: 5,
  THB: 6,
};

/** Quick-pick credit packages (per currency). Popular pack gets the cyan ring + badge. */
const PACKAGES: {
  label: string;
  amountLocal: string;
  currency: CurrencyCode;
  credits: number;
  icon: typeof Zap;
  popular?: boolean;
}[] = [
  { label: "Starter", amountLocal: "50000", currency: "IDR", credits: 50, icon: Zap },
  {
    label: "Pro",
    amountLocal: "150000",
    currency: "IDR",
    credits: 150,
    icon: Rocket,
    popular: true,
  },
  { label: "Studio", amountLocal: "10", currency: "USD", credits: 100, icon: Sparkles },
];

const TOAST_DURATION_MS = 3000;

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
  if (apiErr instanceof ApiError) return apiErr.message || "Top-up gagal";
  if (err instanceof Error) return err.message;
  return "Top-up gagal";
}

function formatAmount(amount: number, currency: CurrencyCode): string {
  try {
    return new Intl.NumberFormat(currency === "IDR" ? "id-ID" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: currency === "IDR" || currency === "JPY" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${currency}`;
  }
}

/* ==========================================================================
 * Top-up dialog
 * ========================================================================== */

export function TopupDialog({ open, onOpenChange, onSuccess }: TopupDialogProps = {}) {
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const [status, setStatus] = useState<TopupStatus>("idle");
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "", type: "success" });
  const [form, setForm] = useState<FormState>({
    amountLocal: "",
    currencyCode: "IDR",
    gateway: "midtrans",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  const isOpen = isControlled ? open : internalOpen;

  /* ---- open / close ---- */

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const openDialog = useCallback(() => setOpen(true), [setOpen]);

  const closeDialog = useCallback(() => {
    setOpen(false);
    setStatus("idle");
    setForm({ amountLocal: "", currencyCode: "IDR", gateway: "midtrans" });
    setErrors({});
  }, [setOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen, closeDialog]);

  /* ---- form handling ---- */

  const updateField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev: FormState) => ({ ...prev, [field]: value }));
    setErrors((prev: Partial<Record<keyof FormState, string>>) => ({
      ...prev,
      [field]: undefined,
    }));
  };

  const validate = useCallback((): boolean => {
    const nextErrors: Partial<Record<keyof FormState, string>> = {};
    const amount = Number(form.amountLocal);

    if (!form.amountLocal || amount <= 0) {
      nextErrors.amountLocal = "Jumlah minimal 1";
    } else if (!Number.isFinite(amount)) {
      nextErrors.amountLocal = "Jumlah tidak valid";
    }

    if (!CURRENCY_OPTIONS.includes(form.currencyCode)) {
      nextErrors.currencyCode = "Mata uang tidak valid";
    }

    if (!GATEWAYS.some((gateway) => gateway.value === form.gateway)) {
      nextErrors.gateway = "Pembayaran tidak valid";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [form.amountLocal, form.currencyCode, form.gateway]);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (status === "loading") return;
      if (!validate()) return;

      const amount = Number(form.amountLocal);
      setStatus("loading");

      try {
        const response = await apiClient.post<unknown>("/api/v1/topups", {
          amountLocal: amount,
          currency: form.currencyCode,
          gateway: form.gateway,
        });
        const tx = unwrap<TopupResponse | null>(response);
        const txId = tx?.txId ?? tx?.id;

        setStatus("success");
        setToast({
          visible: true,
          message: txId
            ? `Top-up pending · ${txId.slice(0, 8)}`
            : "Top-up berhasil dibuat",
          type: "success",
        });

        window.setTimeout(() => {
          setToast((prev: ToastState) => ({ ...prev, visible: false }));
          closeDialog();
          onSuccess?.();
        }, 1200);
      } catch (err) {
        setStatus("error");
        setToast({ visible: true, message: errorMessage(err), type: "error" });
        window.setTimeout(() => {
          setToast((prev: ToastState) => ({ ...prev, visible: false }));
        }, TOAST_DURATION_MS);
      }
    },
    [status, form.amountLocal, form.currencyCode, form.gateway, validate, closeDialog, onSuccess],
  );

  const exchangeRate = DEFAULT_EXCHANGE_RATES[form.currencyCode as CurrencyCode];
  const converted = Number(form.amountLocal) * exchangeRate;
  const activeGateway = GATEWAYS.find((gateway) => gateway.value === form.gateway);

  /* ---- dialog body (shared by controlled / uncontrolled usage) ---- */

  const dialogBody = (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Top Up Kredit</DialogTitle>
        <DialogDescription>
          Pilih paket atau isi jumlah manual untuk menambah saldo kredit.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* credit packages grid */}
        <div className="grid grid-cols-3 gap-3">
          {PACKAGES.map((pkg) => {
            const Icon = pkg.icon;
            const active =
              form.amountLocal === pkg.amountLocal && form.currencyCode === pkg.currency;
            return (
              <button
                key={pkg.label}
                type="button"
                onClick={() => {
                  updateField("amountLocal", pkg.amountLocal);
                  updateField("currencyCode", pkg.currency);
                }}
                aria-pressed={active}
                className={cn(
                  "group relative flex flex-col items-center gap-1 rounded-[var(--radius-lg)] border bg-surface-2 p-3 text-center transition-all duration-200",
                  "hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.97]",
                  "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                  pkg.popular
                    ? "border-[var(--border-accent)] ring-1 ring-accent/60 shadow-[var(--shadow-glow)]"
                    : "border-[var(--border)] hover:border-[var(--border-accent)]",
                  active && "border-[var(--border-accent)] bg-[var(--glow-soft)]",
                )}
              >
                {pkg.popular && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-[var(--gradient-accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#06080d]">
                    Terbaik
                  </span>
                )}
                <Icon
                  className={cn(
                    "size-4 transition-colors duration-200",
                    pkg.popular ? "text-accent" : "text-text-muted group-hover:text-accent",
                  )}
                  aria-hidden="true"
                />
                <span className="font-[family-name:var(--font-display)] text-sm font-semibold text-text">
                  {pkg.label}
                </span>
                <span className="text-xs text-text-muted tabular-nums">
                  {formatAmount(Number(pkg.amountLocal), pkg.currency)}
                </span>
                <span className="text-[10px] font-medium text-accent tabular-nums">
                  {pkg.credits} kredit
                </span>
              </button>
            );
          })}
        </div>

        {/* amount + currency inline */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label
              htmlFor="amountLocal"
              className="mb-1.5 block text-sm font-medium text-text-muted"
            >
              Jumlah (Rp / $)
            </label>
            <input
              id="amountLocal"
              type="number"
              min="1"
              step="1"
              value={form.amountLocal}
              onChange={(e: { target: { value: string } }) =>
                updateField("amountLocal", e.target.value)
              }
              className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-surface-2 px-3.5 py-2.5 text-sm text-text tabular-nums outline-none transition-all duration-200 placeholder:text-[var(--text-faint)] focus:border-[var(--border-accent)] focus:ring-2 focus:ring-[var(--glow-soft)] focus-visible:outline-none"
              placeholder="Masukkan jumlah top-up"
            />
            {errors.amountLocal && (
              <p className="mt-1 text-xs text-danger">{errors.amountLocal}</p>
            )}
          </div>

          <div className="w-36">
            <label
              htmlFor="currencyCode"
              className="mb-1.5 block text-sm font-medium text-text-muted"
            >
              Mata uang
            </label>
            <select
              id="currencyCode"
              value={form.currencyCode}
              onChange={(e: { target: { value: string } }) =>
                updateField("currencyCode", e.target.value as CurrencyCode)
              }
              className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-surface-2 px-3.5 py-2.5 text-sm text-text outline-none transition-all duration-200 focus:border-[var(--border-accent)] focus:ring-2 focus:ring-[var(--glow-soft)] focus-visible:outline-none"
            >
              {CURRENCY_OPTIONS.map((cur) => (
                <option key={cur} value={cur} className="bg-surface">
                  {cur}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* gateway radio */}
        <div>
          <span className="mb-2 block text-sm font-medium text-text-muted">
            Metode pembayaran
          </span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {GATEWAYS.map((gateway) => (
              <label
                key={gateway.value}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-md)] border p-2.5 text-xs font-medium transition-all duration-200",
                  "focus-within:outline-none focus-within:ring-2 focus-within:ring-accent/60",
                  "motion-reduce:transition-none",
                  form.gateway === gateway.value
                    ? "border-[var(--border-accent)] bg-[var(--glow-soft)] text-accent shadow-[var(--shadow-glow)]"
                    : "border-[var(--border)] bg-surface-2 text-text-muted hover:border-[var(--border-accent-soft)] hover:text-text",
                )}
              >
                <input
                  type="radio"
                  name="gateway"
                  value={gateway.value}
                  checked={form.gateway === gateway.value}
                  onChange={() => updateField("gateway", gateway.value)}
                  className="sr-only"
                />
                {gateway.value === "midtrans" && <CreditCard className="size-4" aria-hidden="true" />}
                {gateway.value === "xendit" && <CurrencyDollar className="size-4" aria-hidden="true" />}
                {gateway.value === "tripay" && <Banknote className="size-4" aria-hidden="true" />}
                {gateway.value === "manual" && <Wallet className="size-4" aria-hidden="true" />}
                {gateway.label}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-text-muted">
            {activeGateway ? `${activeGateway.hint} (active)` : "Pilih gateway pembayaran."}
          </p>
          {errors.gateway && <p className="mt-1 text-xs text-danger">{errors.gateway}</p>}
        </div>

        {/* exchange rate display */}
        <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border)] bg-surface-2 px-3.5 py-2.5">
          <span className="text-xs text-text-muted tabular-nums">
            1 kredit = {exchangeRate.toLocaleString()} {form.currencyCode}
          </span>
          <span className="text-sm font-medium text-text tabular-nums">
            {formatAmount(Number.isFinite(converted) ? converted : 0, form.currencyCode)}
          </span>
        </div>

        {/* error / success message */}
        {status === "error" && (
          <div className="flex items-center gap-2 text-sm text-danger" role="alert">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {toast.message}
          </div>
        )}
        {status === "success" && (
          <div className="flex items-center gap-2 text-sm text-success" role="status">
            <CheckCircle className="size-4" aria-hidden="true" />
            Top-up berhasil dibuat
          </div>
        )}

        {/* actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={closeDialog}
            className="flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-surface-2 px-4 py-2.5 text-sm font-medium text-text-muted transition-colors duration-200 hover:border-[var(--border-strong)] hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.98] motion-reduce:transition-none"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={status === "loading"}
            className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--gradient-accent)] px-4 py-2.5 text-sm font-semibold text-[#06080d] shadow-[var(--shadow-glow)] transition-all duration-200 hover:shadow-[var(--shadow-glow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:shadow-[var(--shadow-glow)]"
          >
            {status === "loading" ? (
              <>
                <Loader className="size-4 animate-spin" aria-hidden="true" />
                Memproses...
              </>
            ) : (
              <>
                <CreditCard className="size-4" aria-hidden="true" />
                Top Up
              </>
            )}
          </button>
        </div>
      </form>
    </DialogContent>
  );

  // Uncontrolled usage gets a built-in trigger button.
  if (!isControlled) {
    return (
      <>
        <button
          type="button"
          onClick={openDialog}
          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--gradient-accent)] px-4 py-2.5 text-sm font-semibold text-[#06080d] shadow-[var(--shadow-glow)] transition-all duration-200 hover:shadow-[var(--shadow-glow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.98] motion-reduce:transition-none"
        >
          <CreditCard className="size-4" aria-hidden="true" />
          Top Up
        </button>
        <Dialog open={isOpen} onOpenChange={(next) => (next ? setOpen(true) : closeDialog())}>
          {dialogBody}
        </Dialog>
      </>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(next) => (next ? setOpen(true) : closeDialog())}>
      {dialogBody}
    </Dialog>
  );
}

export default TopupDialog;
