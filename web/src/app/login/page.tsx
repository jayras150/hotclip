"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ApiError, apiClient } from "@/lib/api";
import { AuthCard } from "@/components/AuthCard";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/** Only allow same-origin paths, so `?redirectTo=` cannot send users off-site. */
function safeRedirect(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function LoginScreen() {
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get("redirectTo"));

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (pending) return;

    setError(null);
    setPending(true);

    try {
      const response =
        mode === "login"
          ? await apiClient.signInEmail(email, password)
          : await apiClient.registerEmail(email.trim(), password, name.trim());

      apiClient.setToken(response.token);
      window.location.href = redirectTo;
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setPending(false);
    }
  }

  async function handleOAuth(provider: "google" | "github") {
    if (pending) return;

    setError(null);
    setPending(true);

    try {
      const result = await apiClient.auth(provider);
      if (result?.token) {
        apiClient.setToken(result.token);
        window.location.href = redirectTo;
        return;
      }
      // Backend did not return a token: fall back to the server-side flow.
      window.location.href = `${API_BASE_URL}/api/v1/auth/${provider}`;
    } catch {
      // The POST endpoint is unavailable or expects a browser redirect.
      window.location.href = `${API_BASE_URL}/api/v1/auth/${provider}`;
    } finally {
      setPending(false);
    }
  }

  function handleToggleMode() {
    setMode((current) => (current === "login" ? "register" : "login"));
    setError(null);
  }

  return (
    <AuthCard
      mode={mode}
      email={email}
      password={password}
      name={name}
      pending={pending}
      error={error}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onNameChange={setName}
      onSubmit={handleSubmit}
      onOAuth={handleOAuth}
      onToggleMode={handleToggleMode}
    />
  );
}

function LoginFallback() {
  return (
    <div className="w-full animate-pulse rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-black/30 sm:p-8">
      <div className="h-9 w-28 rounded-xl bg-surface-2" />
      <div className="mt-8 h-7 w-44 rounded-lg bg-surface-2" />
      <div className="mt-2 h-4 w-64 max-w-full rounded bg-surface-2" />
      <div className="mt-8 space-y-4">
        <div className="h-11 rounded-xl bg-surface-2" />
        <div className="h-11 rounded-xl bg-surface-2" />
        <div className="h-11 rounded-xl bg-surface-2" />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="relative flex min-h-[calc(100vh-0px)] items-center justify-center overflow-hidden bg-[var(--bg)] px-4 py-12">
      {/* Decorative cyan/blue glow orbs — Obsidian Cyber-Studio */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,var(--glow),transparent_70%)] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--accent-2)_35%,transparent),transparent_70%)] blur-3xl"
      />

      <div className="relative z-10 w-full max-w-md">
        <Suspense fallback={<LoginFallback />}>
          <LoginScreen />
        </Suspense>
      </div>
    </main>
  );
}
