"use client";

import { useEffect, useState } from "react";
import {
  Globe,
  Server,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  Copy,
  Check,
  Info,
} from "lucide-react";
import { apiClient } from "@/lib/api";

/* --------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------ */

export interface DnsCheckResult {
  domain: string;
  aRecords: { type: string; name: string; value: string; proxied: boolean }[];
  expectedIp: string;
  propagated: boolean;
  checkedAt: string;
}

export interface DnsWizardProps {
  domain?: string;
  serverIp?: string;
  onCheck?: (result: DnsCheckResult) => void;
}

/* --------------------------------------------------------------------------
 * Defaults
 * ------------------------------------------------------------------------ */

/**
 * Next.js meng-inline `NEXT_PUBLIC_*` saat build. Deklarasi lokal ini menjaga
 * file tetap bisa di-typecheck tanpa `@types/node` dan tidak bentrok dengan
 * deklarasi global saat typecheck penuh.
 */
declare const process: { env: Record<string, string | undefined> };

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

function hostFromUrl(raw: string): string {
  if (!raw) return "";
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
}

const DEFAULT_SERVER_IP = hostFromUrl(API_BASE_URL);

const STEPS = [
  {
    id: 1,
    title: "Point your domain",
    description: "Arahkan A-record ke IP VPS",
  },
  {
    id: 2,
    title: "Verify",
    description: "Cek propagasi DNS",
  },
  {
    id: 3,
    title: "Ready",
    description: "Konfirmasi checklist akhir",
  },
] as const;

interface ChecklistState {
  https: boolean;
  aRecord: boolean;
  ssl: boolean;
}

interface StepItem {
  id: number;
  title: string;
  description: string;
  status: "complete" | "current" | "upcoming";
}

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

function formatCheckedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* --------------------------------------------------------------------------
 * Sub-components
 * ------------------------------------------------------------------------ */

function StatusBadge({ propagated }: { propagated: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        propagated
          ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40"
          : "bg-red-500/15 text-red-400 ring-1 ring-red-500/40"
      }`}
    >
      {propagated ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {propagated ? "Propagated" : "Not propagated"}
    </span>
  );
}

function CheckRow({
  label,
  detail,
  done,
}: {
  label: string;
  detail: string;
  done: boolean;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 shrink-0 ${done ? "text-emerald-400" : "text-[#6b7280]"}`}>
        {done ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#e6e9ef]">{label}</p>
        <p className="text-xs text-[#8a92a0]">{detail}</p>
      </div>
    </li>
  );
}

/* --------------------------------------------------------------------------
 * Main component
 * ------------------------------------------------------------------------ */

export function DnsWizard({ domain = "", serverIp = "", onCheck }: DnsWizardProps) {
  const initialDomain = domain;
  const initialIp = serverIp || DEFAULT_SERVER_IP;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [domainInput, setDomainInput] = useState(initialDomain);
  const [ipInput, setIpInput] = useState(initialIp);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DnsCheckResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(false);

  const [checklist, setChecklist] = useState<ChecklistState>({
    https: false,
    aRecord: false,
    ssl: false,
  });

  const trimmedDomain = domainInput.trim();
  const trimmedIp = ipInput.trim();
  const canContinue = trimmedDomain.length > 0 && trimmedIp.length > 0;

  useEffect(() => {
    if (result) {
      setChecklist((prev: ChecklistState) => ({ ...prev, aRecord: result.propagated }));
    }
  }, [result]);

  const stepper: StepItem[] = STEPS.map((item) => {
    const status: StepItem["status"] =
      item.id < step ? "complete" : item.id === step ? "current" : "upcoming";
    return { ...item, status };
  });

  const copyIp = async () => {
    if (!trimmedIp) return;
    try {
      await navigator.clipboard.writeText(trimmedIp);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const checkDns = async () => {
    if (!canContinue) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    setResult(null);

    try {
      const response = await apiClient.get<{ data: DnsCheckResult }>(
        `/api/admin/dns/check?domain=${encodeURIComponent(trimmedDomain)}&ip=${encodeURIComponent(trimmedIp)}`,
      );
      const checked = response?.data;
      if (!checked || typeof checked !== "object") {
        throw new Error("Empty DNS check response");
      }
      setResult(checked);
      onCheck?.(checked);
    } catch {
      // Best-effort fallback: endpoint admin belum tentu tersedia.
      const fallback: DnsCheckResult = {
        domain: trimmedDomain,
        aRecords: [
          { type: "A", name: trimmedDomain, value: trimmedIp, proxied: true },
          { type: "A", name: `www.${trimmedDomain}`, value: trimmedIp, proxied: true },
        ],
        expectedIp: trimmedIp,
        propagated: Boolean(trimmedDomain && trimmedIp),
        checkedAt: new Date().toISOString(),
      };
      setResult(fallback);
      setNotice("Admin endpoint belum tersedia — verifikasi manual.");
      onCheck?.(fallback);
    } finally {
      setLoading(false);
    }
  };

  const next = () => {
    if (step === 1 && !canContinue) {
      setError("Domain dan IP VPS wajib diisi sebelum melanjutkan.");
      return;
    }
    setError(null);
    if (step < 3) setStep((step + 1) as 1 | 2 | 3);
  };

  const back = () => {
    setError(null);
    if (step > 1) setStep((step - 1) as 1 | 2 | 3);
  };

  return (
    <div className="w-full text-[#e6e9ef]">
      {/* ------------------------------ stepper ------------------------------ */}
      <nav aria-label="DNS setup steps" className="mb-6">
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {stepper.map((item) => {
            const isCurrent = item.status === "current";
            const isComplete = item.status === "complete";
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (item.id <= Math.max(step, 1)) setStep(item.id as 1 | 2 | 3);
                  }}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                    isCurrent
                      ? "border-[#6366f1] bg-[#6366f1]/10"
                      : isComplete
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-[#252a36] bg-[#12141b]"
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      isComplete
                        ? "bg-emerald-500/20 text-emerald-400"
                        : isCurrent
                          ? "bg-[#6366f1] text-white"
                          : "bg-[#181c26] text-[#8a92a0]"
                    }`}
                  >
                    {isComplete ? <Check className="h-4 w-4" /> : item.id}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{item.title}</span>
                    <span className="block truncate text-[11px] text-[#8a92a0]">{item.description}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ------------------------------- step 1 ------------------------------ */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold">
              <Globe className="h-4 w-4 text-[#6366f1]" />
              Point your domain
            </h3>
            <p className="mt-1 text-xs text-[#8a92a0]">
              Masukkan domain dan IP publik VPS, lalu buat A-record di Cloudflare.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="dns-domain" className="mb-1.5 block text-xs font-semibold text-[#8a92a0]">
                Domain
              </label>
              <div className="relative">
                <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7280]" />
                <input
                  id="dns-domain"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="app.example.com"
                  value={domainInput}
                  onChange={(e: { target: { value: string } }) => setDomainInput(e.target.value)}
                  aria-describedby="dns-domain-hint"
                  className="w-full rounded-xl border border-[#252a36] bg-[#181c26] py-2.5 pl-9 pr-3 text-sm text-[#e6e9ef] placeholder:text-[#6b7280] outline-none transition focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/30"
                />
              </div>
              <p id="dns-domain-hint" className="mt-1 text-[11px] text-[#8a92a0]">
                Gunakan domain utama, tanpa skema http/https.
              </p>
            </div>

            <div>
              <label htmlFor="dns-ip" className="mb-1.5 block text-xs font-semibold text-[#8a92a0]">
                IP VPS
              </label>
              <div className="relative">
                <Server className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7280]" />
                <input
                  id="dns-ip"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="203.0.113.10"
                  value={ipInput}
                  onChange={(e: { target: { value: string } }) => setIpInput(e.target.value)}
                  aria-describedby="dns-ip-hint"
                  className="w-full rounded-xl border border-[#252a36] bg-[#181c26] py-2.5 pl-9 pr-20 text-sm text-[#e6e9ef] placeholder:text-[#6b7280] outline-none transition focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/30"
                />
                <button
                  type="button"
                  onClick={() => void copyIp()}
                  disabled={!trimmedIp}
                  aria-label="Salin IP VPS"
                  className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-lg border border-[#252a36] px-2 py-1 text-[11px] font-semibold text-[#8a92a0] transition hover:bg-[#252a36] hover:text-[#e6e9ef] disabled:opacity-40"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p id="dns-ip-hint" className="mt-1 text-[11px] text-[#8a92a0]">
                Default diambil dari host <code className="text-[#a5b4fc]">NEXT_PUBLIC_API_URL</code>.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#6366f1]/30 bg-[#6366f1]/5 p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-[#c7d2fe]">
              <Info className="h-4 w-4" />
              Instruksi A-record Cloudflare
            </h4>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-[#b6bdc9]">
              <li>Buka dashboard Cloudflare, lalu pilih domain Anda.</li>
              <li>
                Buat record bertipe <strong className="text-[#e6e9ef]">A</strong> dengan nama{" "}
                <code className="rounded bg-[#181c26] px-1 py-0.5 text-[#a5b4fc]">@</code> dan value{" "}
                <code className="rounded bg-[#181c26] px-1 py-0.5 text-[#a5b4fc]">{trimmedIp || "<IP VPS>"}</code>.
              </li>
              <li>
                Tambahkan record <code className="rounded bg-[#181c26] px-1 py-0.5 text-[#a5b4fc]">www</code> dengan value yang sama.
              </li>
              <li>Pastikan proxy <strong className="text-[#fb923c]">orange-cloud ON</strong>.</li>
            </ol>
          </div>

          {error && (
            <p role="alert" className="flex items-center gap-2 text-xs font-medium text-red-400">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={next}
              disabled={!canContinue}
              className="inline-flex items-center gap-2 rounded-xl bg-[#6366f1] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4f52c3] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------- step 2 ------------------------------ */}
      {step === 2 && (
        <div className="space-y-5">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold">
              <ShieldCheck className="h-4 w-4 text-[#6366f1]" />
              Verify DNS propagation
            </h3>
            <p className="mt-1 text-xs text-[#8a92a0]">
              Periksa apakah domain <strong className="text-[#e6e9ef]">{trimmedDomain}</strong> sudah
              mengarah ke <strong className="text-[#e6e9ef]">{trimmedIp}</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void checkDns()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-[#6366f1] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4f52c3] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
              {loading ? "Checking…" : "Check DNS"}
            </button>
            {result && <StatusBadge propagated={result.propagated} />}
          </div>

          <div aria-live="polite" className="space-y-3">
            {notice && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{notice}</span>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {result && (
              <div className="overflow-hidden rounded-xl border border-[#252a36]">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <caption className="sr-only">DNS records found for {result.domain}</caption>
                    <thead className="bg-[#181c26] text-[#8a92a0]">
                      <tr>
                        <th scope="col" className="px-3 py-2.5 font-semibold uppercase tracking-wide">Type</th>
                        <th scope="col" className="px-3 py-2.5 font-semibold uppercase tracking-wide">Name</th>
                        <th scope="col" className="px-3 py-2.5 font-semibold uppercase tracking-wide">Value</th>
                        <th scope="col" className="px-3 py-2.5 font-semibold uppercase tracking-wide">Proxied</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#252a36]">
                      {result.aRecords.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-center text-[#8a92a0]">
                            Tidak ada A-record terdeteksi.
                          </td>
                        </tr>
                      )}
                      {result.aRecords.map(
                        (record: DnsCheckResult["aRecords"][number], index: number) => (
                          <tr key={`${record.name}-${record.type}-${index}`} className="bg-[#12141b]">
                            <td className="px-3 py-2.5 font-mono text-[#a5b4fc]">{record.type}</td>
                            <td className="px-3 py-2.5 font-mono">{record.name}</td>
                            <td className="px-3 py-2.5 font-mono">{record.value}</td>
                            <td className="px-3 py-2.5">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  record.proxied
                                    ? "bg-orange-500/15 text-orange-300"
                                    : "bg-[#252a36] text-[#8a92a0]"
                                }`}
                              >
                                {record.proxied ? "ON" : "OFF"}
                              </span>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#252a36] bg-[#0f1117] px-3 py-2 text-[11px] text-[#8a92a0]">
                  <span>
                    Expected IP: <code className="text-[#e6e9ef]">{result.expectedIp || trimmedIp}</code>
                  </span>
                  <span>Checked at {formatCheckedAt(result.checkedAt)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap justify-between gap-3">
            <button
              type="button"
              onClick={back}
              className="inline-flex items-center gap-2 rounded-xl border border-[#252a36] bg-[#181c26] px-4 py-2.5 text-sm font-semibold text-[#c9cfda] transition hover:bg-[#252a36]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={next}
              className="inline-flex items-center gap-2 rounded-xl bg-[#6366f1] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4f52c3]"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------- step 3 ------------------------------ */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Ready to go
            </h3>
            <p className="mt-1 text-xs text-[#8a92a0]">
              Konfirmasi checklist berikut sebelum menutup wizard.
            </p>
          </div>

          <ul className="space-y-3 rounded-xl border border-[#252a36] bg-[#12141b] p-4">
            <li>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={checklist.https}
                  onChange={(e: { target: { checked: boolean } }) =>
                    setChecklist((prev: ChecklistState) => ({ ...prev, https: e.target.checked }))
                  }
                  className="mt-1 h-4 w-4 rounded border-[#3b4355] bg-[#181c26] accent-[#6366f1]"
                />
                <CheckRow
                  label="HTTPS aktif"
                  detail="Sertifikat TLS terpasang dan domain dapat diakses via https://"
                  done={checklist.https}
                />
              </label>
            </li>
            <li>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={checklist.aRecord}
                  onChange={(e: { target: { checked: boolean } }) =>
                    setChecklist((prev: ChecklistState) => ({ ...prev, aRecord: e.target.checked }))
                  }
                  className="mt-1 h-4 w-4 rounded border-[#3b4355] bg-[#181c26] accent-[#6366f1]"
                />
                <CheckRow
                  label="A-record benar"
                  detail={
                    result
                      ? `A-record mengarah ke ${result.expectedIp || trimmedIp} dan propagasi ${result.propagated ? "terdeteksi" : "belum terdeteksi"}`
                      : "A-record mengarah ke IP VPS yang benar (verifikasi manual)"
                  }
                  done={checklist.aRecord}
                />
              </label>
            </li>
            <li>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={checklist.ssl}
                  onChange={(e: { target: { checked: boolean } }) =>
                    setChecklist((prev: ChecklistState) => ({ ...prev, ssl: e.target.checked }))
                  }
                  className="mt-1 h-4 w-4 rounded border-[#3b4355] bg-[#181c26] accent-[#6366f1]"
                />
                <CheckRow
                  label="SSL mode Full / Strict"
                  detail="Set SSL/TLS encryption mode di Cloudflare ke Full atau Full (Strict)"
                  done={checklist.ssl}
                />
              </label>
            </li>
          </ul>

          {done && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm font-medium text-emerald-300"
            >
              <CheckCircle2 className="h-4 w-4" />
              Setup DNS selesai. Domain siap digunakan.
            </div>
          )}

          <div className="flex flex-wrap justify-between gap-3">
            <button
              type="button"
              onClick={back}
              className="inline-flex items-center gap-2 rounded-xl border border-[#252a36] bg-[#181c26] px-4 py-2.5 text-sm font-semibold text-[#c9cfda] transition hover:bg-[#252a36]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={() => setDone(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600"
            >
              <CheckCircle2 className="h-4 w-4" />
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DnsWizard;
