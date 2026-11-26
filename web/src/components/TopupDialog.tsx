"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CreditCard,
  CheckCircle,
  X,
  Loader,
  CircleDollarSign as CurrencyDollar,
  Banknote,
  AlertTriangle,
  Wallet,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";

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
 * Top-up dialog (portal-free, modal overlay with blur backdrop)
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
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "unset";
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

  /* ---- backdrop + overlay (blur) ---- */

  const overlay = useMemo(() => {
    if (!isOpen) return null;
    const exchangeRate = DEFAULT_EXCHANGE_RATES[form.currencyCode as CurrencyCode];
    const converted = Number(form.amountLocal) * exchangeRate;
    const activeGateway = GATEWAYS.find((gateway) => gateway.value === form.gateway);

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onClick={(e: { target: unknown; currentTarget: unknown }) => {
          if (e.target === e.currentTarget) closeDialog();
        }}
      >
        {/* ---- dialog ---- */}
        <div className="w-full max-w-md rounded-2xl border border-[#262a35] bg-[#12141a] p-6 shadow-2xl">
          {/* header */}
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#f3f4f8]">Top Up Kredit</h2>
              <p className="mt-0.5 text-xs text-[#8f95a3]">
                Isi form di bawah untuk menambah saldo kredit
              </p>
            </div>
            <button
              type="button"
              onClick={closeDialog}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#262a35] text-[#8f95a3] transition hover:bg-[#191c24] hover:text-[#f3f4f8]"
              aria-label="Tutup"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* amount + currency inline */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label
                  htmlFor="amountLocal"
                  className="mb-1.5 block text-sm font-medium text-[#8f95a3]"
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
                  className="w-full rounded-xl border border-[#262a35] bg-[#191c24] px-3.5 py-2.5 text-sm text-[#f3f4f8] outline-none transition focus:border-[#ff4d2e] focus:ring-2 focus:ring-[#ff4d2e]/30"
                  placeholder="Masukkan jumlah top-up"
                />
                {errors.amountLocal && (
                  <p className="mt-1 text-xs text-red-400">{errors.amountLocal}</p>
                )}
              </div>

              <div className="w-36">
                <label
                  htmlFor="currencyCode"
                  className="mb-1.5 block text-sm font-medium text-[#8f95a3]"
                >
                  Mata uang
                </label>
                <select
                  id="currencyCode"
                  value={form.currencyCode}
                  onChange={(e: { target: { value: string } }) =>
                    updateField("currencyCode", e.target.value as CurrencyCode)
                  }
                  className="w-full rounded-xl border border-[#262a35] bg-[#191c24] px-3.5 py-2.5 text-sm text-[#f3f4f8] outline-none transition focus:border-[#ff4d2e] focus:ring-2 focus:ring-[#ff4d2e]/30"
                >
                  {CURRENCY_OPTIONS.map((cur) => (
                    <option key={cur} value={cur} className="bg-[#12141a]">
                      {cur}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* gateway radio */}
            <div>
              <span className="mb-2 block text-sm font-medium text-[#8f95a3]">
                Metode pembayaran
              </span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {GATEWAYS.map((gateway) => (
                  <label
                    key={gateway.value}
                    className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-medium transition ${
                      form.gateway === gateway.value
                        ? "border-[#ff4d2e] bg-[#1a0f0a] text-[#ff4d2e]"
                        : "border-[#262a35] bg-[#191c24] text-[#8f95a3] hover:border-[#ff4d2e]/40 hover:text-[#f3f4f8]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="gateway"
                      value={gateway.value}
                      checked={form.gateway === gateway.value}
                      onChange={() => updateField("gateway", gateway.value)}
                      className="sr-only"
                    />
                    {gateway.value === "midtrans" && <CreditCard className="h-4 w-4" />}
                    {gateway.value === "xendit" && <CurrencyDollar className="h-4 w-4" />}
                    {gateway.value === "tripay" && <Banknote className="h-4 w-4" />}
                    {gateway.value === "manual" && <Wallet className="h-4 w-4" />}
                    {gateway.label}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-[#8f95a3]">
                {activeGateway ? `${activeGateway.hint} (active)` : "Pilih gateway pembayaran."}
              </p>
              {errors.gateway && <p className="mt-1 text-xs text-red-400">{errors.gateway}</p>}
            </div>

            {/* exchange rate display */}
            <div className="flex items-center justify-between rounded-xl border border-[#262a35] bg-[#191c24] px-3.5 py-2.5">
              <span className="text-xs text-[#8f95a3]">
                1 kredit = {exchangeRate.toLocaleString()} {form.currencyCode}
              </span>
              <span className="text-sm font-medium text-[#f3f4f8]">
                {formatAmount(Number.isFinite(converted) ? converted : 0, form.currencyCode)}
              </span>
            </div>

            {/* error / success message */}
            {status === "error" && (
              <div className="flex items-center gap-2 text-sm text-red-400">
                <AlertTriangle className="h-4 w-4" />
                {toast.message}
              </div>
            )}
            {status === "success" && (
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <CheckCircle className="h-4 w-4" />
                Top-up berhasil dibuat
              </div>
            )}

            {/* actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={closeDialog}
                className="flex-1 rounded-xl border border-[#262a35] bg-[#191c24] px-4 py-2.5 text-sm font-medium text-[#8f95a3] transition hover:bg-[#12141a] hover:text-[#f3f4f8]"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={status === "loading"}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#ff4d2e] to-[#ff9a3d] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#ff4d2e]/20 transition hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
              >
                {status === "loading" ? (
                  <>
                    <Loader className="h-4 w-4 animate-spin" />
                    Memproses...
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" />
                    Top Up
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }, [
    isOpen,
    form,
    errors,
    status,
    toast,
    closeDialog,
    handleSubmit,
  ]);

  // Uncontrolled usage gets a built-in trigger button.
  if (!isControlled) {
    return (
      <>
        <button
          type="button"
          onClick={openDialog}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#ff4d2e] to-[#ff9a3d] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#ff4d2e]/20 transition hover:scale-[1.02] active:scale-95"
        >
          <CreditCard className="h-4 w-4" />
          Top Up
        </button>
        {overlay}
      </>
    );
  }

  return overlay;
}

export default TopupDialog;
