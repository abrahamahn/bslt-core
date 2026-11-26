// main/kernel/contract/src/ports.ts

// ============================================================================
// Observability Port
// ============================================================================

interface BreadcrumbData {
  [key: string]: unknown;
  category?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  type?: string;
}

export interface ErrorTracker {
  captureError(error: unknown, context?: Record<string, unknown>): void;
  addBreadcrumb(message: string, data?: BreadcrumbData): void;
  setUserContext(userId: string, email?: string): void;
}

// ============================================================================
// Storage Port
// ============================================================================

type StorageBackend = 'local' | 's3' | 'gcs' | 'azure' | 'database' | 'memory';

interface ReadableStreamDefaultReaderLike<R> {
  read(): Promise<{ done: boolean; value?: R }>;
  releaseLock(): void;
}

export interface ReadableStreamLike<R = unknown> {
  getReader(): ReadableStreamDefaultReaderLike<R>;
}

export interface StorageClient {
  upload(
    key: string,
    data: Uint8Array | string | ReadableStreamLike<Uint8Array>,
    contentType: string,
  ): Promise<string>;
  download(key: string): Promise<Uint8Array>;
  downloadStream(key: string): Promise<ReadableStreamLike<Uint8Array>>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

interface BaseStorageConfig {
  provider: StorageBackend;
  baseUrl?: string;
  maxFileSize: number;
  allowedTypes: string[];
  defaultAcl?: 'private' | 'public-read';
  cacheControl?: string;
  uniqueFilenames?: boolean;
  pathPrefix?: string;
}

export interface LocalStorageConfig extends BaseStorageConfig {
  provider: 'local';
  rootPath: string;
  publicBaseUrl?: string;
  signingSecret: string;
}

export interface S3StorageConfig extends BaseStorageConfig {
  provider: 's3';
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle: boolean;
  presignExpiresInSeconds: number;
}

export type StorageConfig = LocalStorageConfig | S3StorageConfig;

interface StorageService {
  upload(key: string, data: Uint8Array | string, contentType: string): Promise<string>;
  download(key: string): Promise<unknown>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresIn: number): Promise<string>;
}

// ============================================================================
// Email & Notifications Ports
// ============================================================================

interface Attachment {
  filename: string;
  content: Uint8Array | string;
  contentType?: string;
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: Attachment[];
  headers?: Record<string, string>;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailService {
  send(options: EmailOptions): Promise<SendResult>;
  healthCheck?(): Promise<boolean>;
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: {
    user: string;
    pass: string;
  };
  connectionTimeout: number;
  socketTimeout: number;
}

export interface EmailConfig {
  provider: 'console' | 'smtp';
  smtp: SmtpConfig;
  apiKey?: string;
  from: {
    name: string;
    address: string;
  };
  replyTo: string;
}

export interface NotificationService {
  isConfigured(): boolean;
  getWebPushProvider?(): unknown;
}

// ============================================================================
// Request & Platform Context Ports
// ============================================================================

export interface AuthenticatedUser {
  userId: string;
  role: string;
  tenantId?: string | undefined;
  email?: string | undefined;
}

export interface RequestInfo {
  ip: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface RequestContext {
  user?: AuthenticatedUser | undefined;
  requestInfo: RequestInfo;
  correlationId?: string | undefined;
  headers?: Record<string, string | string[] | undefined> | undefined;
  cookies?: Record<string, string | undefined> | undefined;
}

export interface SystemPort<TDb = unknown, TRepos = unknown> {
  readonly db: TDb;
  readonly repos: TRepos;
}

interface ContextLoggerLike {
  trace(first: unknown, second?: unknown): void;
  debug(first: unknown, second?: unknown): void;
  info(first: unknown, second?: unknown): void;
  warn(first: unknown, second?: unknown): void;
  error(first: unknown, second?: unknown, third?: unknown): void;
  fatal(first: unknown, second?: unknown, third?: unknown): void;
  child(bindings: Record<string, unknown>): ContextLoggerLike;
}

export interface BaseContext {
  email?: EmailService | undefined;
  storage?:
    | StorageService
    | {
        upload(key: string, data: Uint8Array | string, contentType: string): Promise<string>;
        delete(key: string): Promise<void>;
        getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
      }
    | undefined;
  notifications?: NotificationService | undefined;
  cache?: unknown;
  pubsub?: unknown;
  queue?: unknown;
  config: unknown;
  db: unknown;
  repos: unknown;
  system: SystemPort;
  log: ContextLoggerLike;
  errorTracker?: ErrorTracker | undefined;
  contextualize(session: { userId?: string; role?: string; tenantId?: string }): BaseContext;
}

// ============================================================================
// Pagination & Realtime PubSub Wire Vocabulary
// ============================================================================

export type SortOrder = 'asc' | 'desc';

export interface PaginationOptions {
  page: number;
  limit: number;
  sortBy?: string | undefined;
  sortOrder: SortOrder;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
  totalPages: number;
}

export interface CursorPaginationOptions {
  cursor?: string | undefined;
  limit: number;
  sortBy?: string | undefined;
  sortOrder: SortOrder;
}

export interface CursorPaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  hasNext: boolean;
  limit: number;
}

type RecordKey = `record:${string}:${string}`;
type ListKey = `list:${string}:${string}`;
type OrgKey = `org:${string}`;
export type SubscriptionKey = RecordKey | ListKey | OrgKey;

export type ServerMessage =
  | { type: 'update'; key: SubscriptionKey; version: number; timestamp?: number }
  | {
      type: 'sync_response';
      messages: Array<{ key: SubscriptionKey; version: number; timestamp: number }>;
    };

export const SubKeys = {
  record: (table: string, id: string): RecordKey => `record:${table}:${id}`,
  list: (userId: string, listType: string): ListKey => `list:${userId}:${listType}`,
  org: (orgId: string): OrgKey => `org:${orgId}`,
} as const;
