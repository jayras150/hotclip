"use client";

import {
  AlertCircle,
  Chrome,
  Film,
  Github,
  Loader2,
  Lock,
  Mail,
  User,
} from "lucide-react";

export interface AuthCardProps {
  mode: "login" | "register";
  email: string;
  password: string;
  name: string;
  pending: boolean;
  error?: string | null;
  onEmailChange(v: string): void;
  onPasswordChange(v: string): void;
  onNameChange(v: string): void;
  onSubmit(): void;
  onOAuth(provider: "google" | "github"): void;
  onToggleMode(): void;
}

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 " +
  "placeholder:text-slate-400 outline-none transition " +
  "focus:border-[var(--primary)] focus:ring-2 focus:ring-indigo-500/20 " +
  "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60";

const OAUTH_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white " +
  "px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition " +
  "hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export function AuthCard({
  mode,
  email,
  password,
  name,
  pending,
  error,
  onEmailChange,
  onPasswordChange,
  onNameChange,
  onSubmit,
  onOAuth,
  onToggleMode,
}: AuthCardProps) {
  const isRegister = mode === "register";
  const title = isRegister ? "Create account" : "Welcome back";
  const subtitle = isRegister
    ? "Start turning long videos into short, shareable clips."
    : "Sign in to manage your clips, jobs and exports.";
  const submitLabel = isRegister ? "Create account" : "Sign in";

  return (
    <section className="w-full rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-xl shadow-slate-900/5 backdrop-blur sm:p-8">
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary)] text-white shadow-sm">
          <Film className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="text-lg font-semibold tracking-tight text-slate-900">
          HotClip
        </span>
      </div>

      {/* Heading */}
      <div className="mt-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {title}
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>
      </div>

      {/* Error */}
      {error ? (
        <div
          role="alert"
          aria-live="polite"
          className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-[var(--danger)]"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="leading-relaxed">{error}</span>
        </div>
      ) : null}

      {/* Form */}
      <form
        className="mt-6 space-y-4"
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {isRegister ? (
          <div>
            <label htmlFor="auth-name" className="sr-only">
              Full name
            </label>
            <div className="relative">
              <User
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="auth-name"
                name="name"
                type="text"
                autoComplete="name"
                required
                disabled={pending}
                placeholder="Ada Lovelace"
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>
        ) : null}

        <div>
          <label htmlFor="auth-email" className="sr-only">
            Email address
          </label>
          <div className="relative">
            <Mail
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="auth-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              disabled={pending}
              placeholder="you@example.com"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div>
          <label htmlFor="auth-password" className="sr-only">
            Password
          </label>
          <div className="relative">
            <Lock
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
              disabled={pending}
              placeholder="••••••••"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>{isRegister ? "Creating account…" : "Signing in…"}</span>
            </>
          ) : (
            <span>{submitLabel}</span>
          )}
        </button>
      </form>

      {/* Divider */}
      <div className="mt-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          or continue with
        </span>
        <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
      </div>

      {/* OAuth */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onOAuth("google")}
          disabled={pending}
          aria-label="Continue with Google"
          className={OAUTH_BUTTON_CLASS}
        >
          <Chrome className="h-4 w-4" aria-hidden="true" />
          <span>Google</span>
        </button>
        <button
          type="button"
          onClick={() => onOAuth("github")}
          disabled={pending}
          aria-label="Continue with GitHub"
          className={OAUTH_BUTTON_CLASS}
        >
          <Github className="h-4 w-4" aria-hidden="true" />
          <span>GitHub</span>
        </button>
      </div>

      {/* Toggle */}
      <p className="mt-6 text-center text-sm text-slate-500">
        {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
        <button
          type="button"
          onClick={onToggleMode}
          disabled={pending}
          className="font-medium text-[var(--primary)] underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRegister ? "Sign in" : "Create an account"}
        </button>
      </p>
    </section>
  );
}

export default AuthCard;
