// User
export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

// UserRole
export type UserRole = 'admin' | 'editor' | 'viewer';

// Job + JobStatus
export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface Job {
  id: string;
  userId?: string;
  status: JobStatus;
  /** Legacy alias for `sourceUrl`, kept for existing components. */
  inputUrl?: string;
  sourceUrl?: string;
  mediaUrl?: string;
  outputUrl?: string;
  pipeline?: string;
  params?: unknown;
  progress?: number;
  clipCount?: number;
  priority?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// Clip
export interface Clip {
  id: string;
  jobId: string;
  job?: Job;
  status?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  duration?: number;
  score?: number;
  viralScore?: number;
  position?: number;
  previewUrl?: string;
  mediaUrl?: string;
  playbackUrl?: string;
  thumbnailUrl?: string;
  subtitleBurned?: boolean;
  bucket?: string;
  objectKey?: string;
  sizeBytes?: number;
  createdAt?: string;
}

// Wallet
export interface Wallet {
  /** Primary balance used by the UI. */
  balance: number;
  /** ISO currency code used by the UI. */
  currency: string;
  credits_balance?: number;
  local_balance?: number;
  currency_code?: string;
  exchange_rate?: number;
  is_active?: boolean;
  id?: string;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
}

// TopupTransaction
export type TopupTransactionStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'refunded';

export interface TopupTransaction {
  id: string;
  userId?: string;
  walletId?: string;
  /** Amount displayed by the UI. */
  amount: number;
  amountLocal?: number;
  currency: string;
  creditsAdded?: number;
  gateway?: string;
  status: TopupTransactionStatus | string;
  referenceId?: string;
  externalTxId?: string;
  createdAt: string;
  updatedAt?: string;
}

// StorageProvider
export interface StorageProvider {
  id: string;
  name: string;
  provider: 'local' | 's3' | 'gcs' | 'azure';
  endpoint?: string;
  bucket: string;
  region?: string;
  config: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

// VastInstance + VastInstanceStatus
export type VastInstanceStatus =
  | 'pending'
  | 'processing'
  | 'active'
  | 'ready'
  | 'stopped'
  | 'failed'
  | 'cancelled';

export interface VastInstance {
  id: string;
  instanceId?: string;
  externalId?: string;
  offerId?: string;
  workspaceId?: string;
  status: VastInstanceStatus | string;
  url?: string;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;
  blockedUntil?: string;
}

// AuthState
export interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
}

// ErrorResponse
export interface ErrorResponse {
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown>;
}

// Presigned upload result
export interface PresignResult {
  uploadUrl: string;
  objectKey: string;
  method?: string;
}

// DNS check result (`GET /api/admin/dns/check`)
export interface DnsCheckResult {
  domain: string;
  ip?: string;
  ok?: boolean;
  resolved?: boolean;
  records?: string[];
  message?: string;
  [key: string]: unknown;
}

// Paginated response wrapper
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page?: number;
  pageSize?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
}
