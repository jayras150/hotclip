/**
 * Vast.ai SDK bridge (Node built-in only).
 *
 * The Python helper `scripts/vast_manager.py` owns all interactions with the
 * official `vastai` Python SDK. This module spawns that helper, parses its JSON
 * stdout, normalizes snake_case responses into `VastInstance` objects, and
 * enforces the instance blocklist before an offer/instance can be reused.
 *
 * Verification: `npx tsc --noEmit -p tsconfig.node.json`
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";

export type VastInstanceStatus =
  | "pending"
  | "active"
  | "stopped"
  | "terminating"
  | "terminated"
  | "cancelled"
  | "failed";

export interface VastInstance {
  id: string;
  workspaceId: string;
  status: VastInstanceStatus;
  dphTotal: number;
  gpuRam: number;
  cpuCoresEffective: number;
  diskSpace: number;
  inetDown: number;
  inetUp: number;
  reliability2: number;
  location: string;
  createdAt: string;
}

export interface VastFilter {
  maxDphTotal?: number;
  minGpuRam?: number;
  minCpuCoresEffective?: number;
  minDiskSpace?: number;
  minInetDown?: number;
  minInetUp?: number;
  minReliability2?: number;
}

/** Hard AND filters — env-tunable, harga termurah dulu. */
export const VAST_HARD_LIMITS: Required<VastFilter> = {
  maxDphTotal: 0.35,
  minGpuRam: 6,
  minCpuCoresEffective: 2,
  minDiskSpace: 35,
  minInetDown: 400,
  minInetUp: 400,
  minReliability2: 0.95,
};

/**
 * Disk instance tidak boleh melebihi ini, apa pun isi `VAST_DISK_GB`.
 * Dipertahankan sebagai konstanta supaya satu tempat untuk audit billing.
 */
export const VAST_MAX_DISK_GB = 35;

/**
 * Hard limits, overridable per-deployment via env so the offer market can be
 * followed without a rebuild:
 *   VAST_MAX_DPH_TOTAL, VAST_MIN_GPU_RAM, VAST_MIN_CPU_CORES,
 *   VAST_MIN_DISK_SPACE, VAST_MIN_INET_DOWN, VAST_MIN_INET_UP,
 *   VAST_MIN_RELIABILITY2
 */
export function vastHardLimitsFromEnv(
  env: Record<string, string | undefined> = process.env,
): Required<VastFilter> {
  const num = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    maxDphTotal: num(env.VAST_MAX_DPH_TOTAL, VAST_HARD_LIMITS.maxDphTotal),
    minGpuRam: num(env.VAST_MIN_GPU_RAM, VAST_HARD_LIMITS.minGpuRam),
    minCpuCoresEffective: num(
      env.VAST_MIN_CPU_CORES,
      VAST_HARD_LIMITS.minCpuCoresEffective,
    ),
    minDiskSpace: num(env.VAST_MIN_DISK_SPACE, VAST_HARD_LIMITS.minDiskSpace),
    minInetDown: num(env.VAST_MIN_INET_DOWN, VAST_HARD_LIMITS.minInetDown),
    minInetUp: num(env.VAST_MIN_INET_UP, VAST_HARD_LIMITS.minInetUp),
    minReliability2: num(
      env.VAST_MIN_RELIABILITY2,
      VAST_HARD_LIMITS.minReliability2,
    ),
  };
}

export const BOOT_TIMEOUT_MS = 180_000;
export const BLOCKLIST_DURATION_MS = 24 * 60 * 60 * 1000;

export interface VastBlocklistEntry {
  instanceId: string;
  blockedAt: number;
  reason: string;
}

export class VastInstanceBlocklist {
  private readonly entries = new Map<string, VastBlocklistEntry>();

  block(instanceId: string, reason: string): void {
    this.entries.set(instanceId, {
      instanceId,
      blockedAt: Date.now(),
      reason,
    });
  }

  /**
   * Auto-block helper: a boot timeout only blocks when the measured boot time
   * exceeds `BOOT_TIMEOUT_MS` (strictly greater).
   */
  blockOnBootTimeout(instanceId: string, bootElapsedMs: number): void {
    if (!Number.isFinite(bootElapsedMs) || bootElapsedMs <= BOOT_TIMEOUT_MS) {
      return;
    }
    this.block(
      instanceId,
      `boot timeout after ${Math.round(bootElapsedMs)}ms ` +
        `(limit ${BOOT_TIMEOUT_MS}ms)`,
    );
  }

  isBlocked(instanceId: string, now: number = Date.now()): boolean {
    const entry = this.entries.get(instanceId);
    if (!entry) return false;
    return now - entry.blockedAt < BLOCKLIST_DURATION_MS;
  }

  get(instanceId: string): VastBlocklistEntry | null {
    if (!this.isBlocked(instanceId)) return null;
    return this.entries.get(instanceId) ?? null;
  }

  purge(now: number = Date.now()): void {
    for (const [instanceId, entry] of this.entries) {
      if (now - entry.blockedAt >= BLOCKLIST_DURATION_MS) {
        this.entries.delete(instanceId);
      }
    }
  }
}

export interface VastManagerConfig {
  apiKey: string;
  pythonPath?: string;
  scriptPath?: string;
  blocklist?: VastInstanceBlocklist;
}

export interface VastRequestOptions {
  workspaceDir?: string;
  image?: string;
  env?: Record<string, string>;
  /** Container port to map to a public host port (`docker -p <port>`). */
  port?: number;
  /** onstart_cmd executed inside the instance at boot. */
  onstartCmd?: string;
  /**
   * Direct-connection instance: port host yang dipublikasikan masuk ke rentang
   * `direct_port_start..+count` (yang dibaca orchestrator untuk healthcheck).
   * Tanpa ini `show_instance` tidak memetakan port ke host sama sekali.
   */
  direct?: boolean;
}

/** Normalized detail of one running instance (ip + mapped port + status). */
export interface VastInstanceDetail {
  id: string;
  /** Raw `actual_status` (created/loading/running/…) — null saat baru dibuat. */
  status: string | null;
  publicIp: string | null;
  /**
   * container/tcp -> host port, e.g. { "8000/tcp": 40123 }.
   * Catatan: `show_instance` Vast TIDAK mengembalikan `ports` untuk instance
   * docker biasa (diverifikasi lewat probe), jadi field ini biasanya kosong
   * dan `directPortStart` yang dipakai sebagai mapped host port.
   */
  hostPorts: Record<string, number>;
  /** Port host pertama di rentang direct-port instance (mapped worker port). */
  directPortStart: number | null;
  /** Jumlah port host yang dialokasikan untuk instance ini. */
  directPortCount: number | null;
  gpuName: string | null;
  dphTotal: number | null;
}

type JsonRecord = Record<string, unknown>;

interface NumericQueryCondition {
  gte?: number;
  lte?: number;
}

const STATUS_ALIASES: Record<string, VastInstanceStatus> = {
  created: "pending",
  loading: "pending",
  pending: "pending",
  provisioning: "pending",
  scheduling: "pending",
  starting: "pending",
  queued: "pending",
  rebooting: "pending",
  running: "active",
  active: "active",
  ready: "active",
  stopped: "stopped",
  frozen: "stopped",
  paused: "stopped",
  terminating: "terminating",
  destroying: "terminating",
  deleting: "terminating",
  stopping: "terminating",
  terminated: "terminated",
  destroyed: "terminated",
  deleted: "terminated",
  cancelled: "cancelled",
  canceled: "cancelled",
  failed: "failed",
  error: "failed",
  exited: "failed",
  offline: "failed",
  unknown: "failed",
  unhealthy: "failed",
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick(record: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return undefined;
}

function pickRecord(record: JsonRecord, ...keys: string[]): JsonRecord | undefined {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) return value;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asIsoDate(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Vast timestamps are usually epoch seconds; accept milliseconds too.
    const millis = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return asIsoDate(numeric);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

function normalizeStatus(record: JsonRecord): VastInstanceStatus {
  const raw = asString(
    pick(
      record,
      "actual_status",
      "actualStatus",
      "cur_status",
      "curStatus",
      "status",
      "state",
    ),
  );
  if (!raw) return "pending";
  const normalized = STATUS_ALIASES[raw.toLowerCase()];
  return normalized ?? "pending";
}

/** Some SDK responses nest the offer under an `offer` key. */
function unwrapOffer(raw: JsonRecord): JsonRecord {
  const nested = pickRecord(raw, "offer", "data");
  return nested ? { ...raw, ...nested } : raw;
}

function normalizeInstance(raw: unknown): VastInstance | null {
  if (!isRecord(raw)) return null;
  const record = unwrapOffer(raw);

  const id = asString(
    pick(
      record,
      "id",
      "offer_id",
      "offerId",
      "new_contract",
      "contract_id",
      "instance_id",
      "instanceId",
    ),
  );
  if (!id) return null;

  const workspaceId =
    asString(
      pick(record, "workspace_id", "workspaceId", "workspace", "label"),
    ) ?? "";
  const createdAt =
    asIsoDate(
      pick(record, "created_at", "createdAt", "start_date", "startDate"),
    ) ?? new Date().toISOString();

  return {
    id,
    workspaceId,
    status: normalizeStatus(record),
    dphTotal:
      asNumber(pick(record, "dph_total", "dphTotal", "price")) ?? 0,
    gpuRam:
      asNumber(pick(record, "gpu_ram", "gpuRam", "gpu_ram_gb")) ?? 0,
    cpuCoresEffective:
      asNumber(
        pick(
          record,
          "cpu_cores_effective",
          "cpuCoresEffective",
          "cpu_cores",
        ),
      ) ?? 0,
    diskSpace:
      asNumber(pick(record, "disk_space", "diskSpace")) ?? 0,
    inetDown:
      asNumber(pick(record, "inet_down", "inetDown")) ?? 0,
    inetUp:
      asNumber(pick(record, "inet_up", "inetUp")) ?? 0,
    reliability2:
      asNumber(
        pick(record, "reliability2", "reliability_2", "reliability"),
      ) ?? 0,
    location:
      asString(
        pick(
          record,
          "geolocation",
          "location",
          "machine_location",
          "machineLocation",
          "region",
        ),
      ) ?? "",
    createdAt,
  };
}

function resolveFilters(filters: VastFilter = {}): Required<VastFilter> {
  // Baca env tiap panggilan agar operator bisa menyetel pasaran offer tanpa
  // rebuild image.
  const envLimits = vastHardLimitsFromEnv();
  const atMost = (value: number | undefined, hard: number): number =>
    Number.isFinite(value) ? Math.min(value as number, hard) : hard;
  const atLeast = (value: number | undefined, hard: number): number =>
    Number.isFinite(value) ? Math.max(value as number, hard) : hard;

  return {
    maxDphTotal: atMost(filters.maxDphTotal, envLimits.maxDphTotal),
    minGpuRam: atLeast(filters.minGpuRam, envLimits.minGpuRam),
    minCpuCoresEffective: atLeast(
      filters.minCpuCoresEffective,
      envLimits.minCpuCoresEffective,
    ),
    minDiskSpace: atLeast(
      filters.minDiskSpace,
      envLimits.minDiskSpace,
    ),
    minInetDown: atLeast(filters.minInetDown, envLimits.minInetDown),
    minInetUp: atLeast(filters.minInetUp, envLimits.minInetUp),
    minReliability2: atLeast(
      filters.minReliability2,
      envLimits.minReliability2,
    ),
  };
}

function buildQuery(
  filters: Required<VastFilter>,
): Record<string, NumericQueryCondition> {
  return {
    dph_total: { lte: filters.maxDphTotal },
    gpu_ram: { gte: filters.minGpuRam },
    cpu_cores_effective: { gte: filters.minCpuCoresEffective },
    disk_space: { gte: filters.minDiskSpace },
    inet_down: { gte: filters.minInetDown },
    inet_up: { gte: filters.minInetUp },
    reliability2: { gte: filters.minReliability2 },
  };
}

function meetsFilters(
  instance: VastInstance,
  filters: Required<VastFilter>,
): boolean {
  return (
    instance.dphTotal <= filters.maxDphTotal &&
    instance.gpuRam >= filters.minGpuRam &&
    instance.cpuCoresEffective >= filters.minCpuCoresEffective &&
    instance.diskSpace >= filters.minDiskSpace &&
    instance.inetDown >= filters.minInetDown &&
    instance.inetUp >= filters.minInetUp &&
    instance.reliability2 >= filters.minReliability2
  );
}

function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new Error("vast_manager.py returned an empty response");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Tolerate diagnostic lines before/after the JSON payload.
    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]);
      } catch {
        // Keep looking.
      }
    }
  }

  throw new Error("vast_manager.py returned invalid JSON");
}

export class VastManager {
  private readonly apiKey: string;
  private readonly pythonPath: string;
  private readonly scriptPath: string;
  private readonly blocklist: VastInstanceBlocklist;

  constructor(config: VastManagerConfig) {
    if (!config.apiKey) {
      throw new Error("VastManager requires an apiKey");
    }
    this.apiKey = config.apiKey;
    this.pythonPath = config.pythonPath ?? "python3";
    this.scriptPath =
      config.scriptPath ?? resolve(process.cwd(), "scripts", "vast_manager.py");
    this.blocklist = config.blocklist ?? new VastInstanceBlocklist();
  }

  /** Search offers passing the hard filters, cheapest first, blocklist excluded. */
  async search(filters?: VastFilter): Promise<VastInstance[]> {
    const effective = resolveFilters(filters);
    const stdout = await this.run([
      "search",
      "--api-key",
      this.apiKey,
      "--limit",
      "20",
      "--query",
      JSON.stringify(buildQuery(effective)),
    ]);

    const parsed = parseJsonOutput(stdout);
    const rawList: unknown[] = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.offers)
        ? parsed.offers
        : isRecord(parsed) && Array.isArray(parsed.data)
          ? parsed.data
          : [];

    return rawList
      .map((entry) => normalizeInstance(entry))
      .filter((entry): entry is VastInstance => entry !== null)
      .filter((entry) => !this.blocklist.isBlocked(entry.id))
      .filter((entry) => meetsFilters(entry, effective))
      .sort((left, right) => left.dphTotal - right.dphTotal);
  }

  /** Create an instance from an offer through the Python SDK bridge. */
  async requestInstance(
    offerId: string,
    opts: VastRequestOptions = {},
  ): Promise<VastInstance> {
    if (this.blocklist.isBlocked(offerId)) {
      throw new Error(`Vast offer ${offerId} is blocked for 24 hours`);
    }

    const args = [
      "request",
      "--api-key",
      this.apiKey,
      "--offer-id",
      offerId,
      "--workspace",
      opts.workspaceDir ?? "/workspace",
    ];
    if (opts.image) {
      args.push("--image", opts.image);
    }
    if (opts.env) {
      args.push("--env", JSON.stringify(opts.env));
    }
    if (opts.port) {
      args.push("--port", String(opts.port));
    }
    if (opts.onstartCmd) {
      args.push("--onstart", opts.onstartCmd);
    }
    if (opts.direct) {
      args.push("--direct");
    }

    const parsed = parseJsonOutput(await this.run(args));
    const instance = normalizeInstance(parsed);
    if (!instance) {
      throw new Error("vast_manager.py did not return a created instance id");
    }
    if (this.blocklist.isBlocked(instance.id)) {
      throw new Error(`Vast instance ${instance.id} is blocked for 24 hours`);
    }
    return instance;
  }

  /** Show one instance: public IP, mapped ports and actual status. */
  async getInstance(instanceId: string): Promise<VastInstanceDetail | null> {
    let parsed: unknown;
    try {
      parsed = parseJsonOutput(
        await this.run([
          "show",
          "--api-key",
          this.apiKey,
          "--instance-id",
          instanceId,
        ]),
      );
    } catch {
      return null;
    }
    if (!isRecord(parsed)) return null;

    const ports: Record<string, number> = {};
    const rawPorts = parsed.ports;
    if (isRecord(rawPorts)) {
      for (const [key, value] of Object.entries(rawPorts)) {
        // Vast returns either `{ "8000/tcp": [{HostPort: "40123"}] }` or a
        // flat map of port -> host port.
        const first = Array.isArray(value) ? value[0] : value;
        const hostPort =
          isRecord(first) ? asNumber(pick(first, "HostPort", "host_port")) : asNumber(first);
        if (typeof hostPort === "number" && hostPort > 0) {
          ports[key] = hostPort;
        }
      }
    }

    return {
      id: asString(pick(parsed, "id", "instance_id")) ?? instanceId,
      status: asString(pick(parsed, "actual_status", "status")) ?? null,
      publicIp: asString(pick(parsed, "public_ipaddr", "public_ip")) ?? null,
      hostPorts: ports,
      directPortStart:
        asNumber(pick(parsed, "direct_port_start", "directPortStart")) ?? null,
      directPortCount:
        asNumber(pick(parsed, "direct_port_count", "directPortCount")) ?? null,
      gpuName: asString(pick(parsed, "gpu_name")) ?? null,
      dphTotal: asNumber(pick(parsed, "dph_total")) ?? null,
    };
  }

  /** Cancel a pending/running request (destroy at the Vast API level). */
  async cancelRequest(instanceId: string): Promise<void> {
    await this.run([
      "cancel",
      "--api-key",
      this.apiKey,
      "--instance-id",
      instanceId,
    ]);
  }

  /** Destroy an instance and stop all residual billing. */
  async releaseInstance(instanceId: string): Promise<void> {
    await this.run([
      "release",
      "--api-key",
      this.apiKey,
      "--instance-id",
      instanceId,
    ]);
  }

  /** Fetch container logs for an instance. */
  async logs(instanceId: string, tail: number = 200): Promise<string> {
    const stdout = await this.run([
      "logs",
      "--api-key",
      this.apiKey,
      "--instance-id",
      instanceId,
      "--tail",
      String(tail),
    ]);

    let parsed: unknown;
    try {
      parsed = parseJsonOutput(stdout);
    } catch {
      return stdout.trim();
    }

    if (typeof parsed === "string") return parsed;
    if (isRecord(parsed)) {
      const logsValue = parsed.logs ?? parsed.output ?? parsed.data;
      if (typeof logsValue === "string") return logsValue;
    }
    return JSON.stringify(parsed);
  }

  private run(args: string[]): Promise<string> {
    return new Promise<string>((resolvePromise, rejectPromise) => {
      const child = spawn(this.pythonPath, [this.scriptPath, ...args], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        rejectPromise(error);
      };

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (error: Error) => {
        fail(
          new Error(
            `failed to start ${this.pythonPath}: ${error.message}`,
          ),
        );
      });

      child.on("close", (code: number | null, signal: string | null) => {
        if (settled) return;
        if (code === 0) {
          settled = true;
          resolvePromise(stdout);
          return;
        }

        const detail = stderr.trim();
        const status =
          code === null
            ? `terminated by signal ${signal ?? "unknown"}`
            : `exited with code ${code}`;
        fail(
          new Error(
            `vast_manager.py ${args[0] ?? ""} ${status}` +
              (detail.length > 0 ? `: ${detail}` : ""),
          ),
        );
      });
    });
  }
}
