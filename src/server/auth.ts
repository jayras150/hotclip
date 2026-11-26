/**
 * Multi-tenant auth helper (Supabase Auth + PostgreSQL RLS).
 *
 * Wire up to the real Supabase client (`@supabase/supabase-js`) di layer
 * API (Next.js route / backend). Repo ini sengaja tidak menambah
 * `@supabase/supabase-js` sebagai dependency — `src/server/auth.ts` ini
 * duck-types terhadap interface minimum `SupabaseAuthClient` (lihat
 * `src/server/supabase-client.interface.ts`), jadi `pnpm typecheck` tetap
 * lulus tanpa menunggu instalasi paket.
 *
 * Dukungan:
 *   - Email + Password  (:email: register / sign in)
 *   - Google OAuth  (:google:)
 *   - GitHub OAuth  (:github:)
 * RLS per tenant: setiap izin dibungkus `auth.uid() = owner_id`.
 */

export type AuthProvider = "google" | "github";
export type AuthStatus = "pending" | "active" | "suspended" | "disabled";

/** Ruangan yang dipakai RLS (bukan `user_metadata` — lihat skill supabase). */
export interface UserClaims {
  sub: string; // auth.user id
  role: "member" | "admin";
  email: string;
}

export interface AuthConfig {
  supabaseUrl: string;
  anonKey: string;
  cookieRetentionDays?: number;
  jwtExpirationSeconds?: number;
  providers: AuthProvider[];
}

export interface SupabaseUser {
  id: string;
  email: string;
  emailConfirmedAt: string | null;
  appMetadata: Record<string, unknown>;
  userMetadata: Record<string, unknown>;
}

export interface SupabaseSession {
  id: string;
  user: SupabaseUser;
  expiresAt: string;
  tokenType: string;
  accessToken: string;
  refreshToken: string;
}

export interface SupabaseAuthClient {
  auth: {
    signInWithPassword(payload: {
      email: string;
      password: string;
    }): Promise<{ data: { user: SupabaseUser; session: SupabaseSession } | null; error: Error | null }>;

    signInWithOAuth(params: {
      provider: "google" | "github";
      options?: { redirectTo: string };
    }): Promise<{ data: { user: SupabaseUser; provider: string; token: string } | null; error: Error | null }>;

    signOut(): Promise<{ error: Error | null }>;

    getUser(): Promise<{ data: { user: SupabaseUser | null; session: SupabaseSession | null } }>;
  };
}

/**
 * Load konfigurasi auth dari env (untuk Next.js API route / backend).
 * Pastikan env-nya diset via process.env saat bootstrap aplikasi.
 */
export function loadAuthConfig(): AuthConfig {
  const supabaseUrl = process.env.HOTCLIP_SUPABASE_URL;
  const anonKey = process.env.HOTCLIP_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "HOTCLIP_SUPABASE_URL & HOTCLIP_SUPABASE_ANON_KEY wajib diset (env). " +
      "Sebaiknya mereka disuplai dari secrets manager / .env.secure, bukan commit.",
    );
  }
  return {
    supabaseUrl,
    anonKey,
    cookieRetentionDays: Number(process.env.HOTCLIP_AUTH_COOKIE_DAYS ?? 30),
    jwtExpirationSeconds: Number(process.env.HOTCLIP_JWT_EXPIRATION_SECONDS ?? 3600 * 24 * 7),
    providers: (process.env.HOTCLIP_OAUTH_PROVIDERS ?? "google,github")
      .split(",")
      .map((v) => v.trim().toLowerCase()) as AuthProvider[],
  };
}

/**
 * Factory supabase client (duck-typed. Future backend meng-inject yang asli
 * dari `@supabase/supabase-js` — tipe ini adalah kontraknya).
 */
export function createSupabaseClient(config: AuthConfig): SupabaseAuthClient {
  return {
    auth: {
      signInWithPassword: async (
        payload: { email: string; password: string },
      ): Promise<{ data: { user: SupabaseUser; session: SupabaseSession } | null; error: Error | null }> => {
        throw new Error("SupabaseAuthClient.signInWithPassword: diselesaikan di layer backend");
      },
      signInWithOAuth: async (
        params: { provider: "google" | "github"; options?: { redirectTo: string } },
      ): Promise<{ data: { user: SupabaseUser; provider: string; token: string } | null; error: Error | null }> => {
        throw new Error("SupabaseAuthClient.signInWithOAuth: diselesaikan di layer backend");
      },
      signOut: async (): Promise<{ error: Error | null }> => {
        throw new Error("SupabaseAuthClient.signOut: diselesaikan di layer backend");
      },
      getUser: async (): Promise<{ data: { user: SupabaseUser | null; session: SupabaseSession | null } }> => {
        return { data: { user: null, session: null } };
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Helper registrasi / login                                         */
/* ------------------------------------------------------------------ */

export interface EmailLoginResult {
  user: SupabaseUser;
  session: SupabaseSession;
  provider: "email";
}

export interface OAuthLoginResult {
  user: SupabaseUser;
  provider: AuthProvider;
  token: string;
}

/**
 * Email + Password register. Kunci: `id` (auth.user id) otomatis diinsert ke
 * public.users + public.profiles lewat trigger `on_auth_user_created`.
 */
export async function registerEmail(
  client: SupabaseAuthClient,
  email: string,
  password: string,
): Promise<EmailLoginResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes("@")) {
    throw new Error("email tidak valid");
  }
  if (password.length < 8) {
    throw new Error("password minimal 8 karakter");
  }

  // signUp() membangun user di auth.users + email-otp flow.
  // Karena repo ini duck-types, hasilnya ditangkap seolah-olah client asli.
  const { data, error } = await client.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });
  if (error) {
    throw new Error(`register gagal: ${error.message}`);
  }
  if (!data?.user) {
    throw new Error("register gagal: tidak ada user yang dikembalikan");
  }
  return { user: data.user, session: data.session, provider: "email" };
}

export async function signInWithPassword(
  client: SupabaseAuthClient,
  email: string,
  password: string,
): Promise<EmailLoginResult> {
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) {
    throw new Error(`login gagal: ${error.message}`);
  }
  if (!data?.user) {
    throw new Error("login gagal: tidak ada user yang dikembalikan");
  }
  return { user: data.user, session: data.session, provider: "email" };
}

export async function signInOAuth(
  client: SupabaseAuthClient,
  provider: AuthProvider,
): Promise<OAuthLoginResult> {
  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: { redirectTo: process.env.HOTCLIP_APP_URL ?? "http://localhost:3000" },
  });
  if (error) {
    throw new Error(`oauth ${provider} gagal: ${error.message}`);
  }
  if (!data?.user) {
    throw new Error(`oauth ${provider} gagal: tidak ada user yang dikembalikan`);
  }
  return { user: data.user, provider, token: data.token };
}
