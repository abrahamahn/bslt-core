// main/shared/src/constants/media.ts
/**
 * Media-related constants.
 *
 * Provides comprehensive lists of allowed extensions, MIME types, and
 * magic number signatures for file validation and processing.
 */

// ============================================================================
// File Extension Constants
// ============================================================================

/** Supported image file extensions. */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'] as const;
/** Supported audio file extensions. */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'] as const;
/** Supported video file extensions. */
export const VIDEO_EXTENSIONS = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv'] as const;

/** All supported media file extensions. */
export const ALL_MEDIA_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
] as const;

// ============================================================================
// MIME Type Constants
// ============================================================================

/** Common image MIME types allowed for basic uploads. */
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Alias for ALLOWED_IMAGE_MIME_TYPES. */
export const ALLOWED_IMAGE_TYPES = ALLOWED_IMAGE_MIME_TYPES;

/** All media MIME types allowed across the platform. */
export const ALLOWED_MEDIA_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  'image/gif',
  'image/avif',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
  'audio/mp4',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
] as const;

// ============================================================================
// Extension ↔ MIME Mappings
// ============================================================================

/** Mappings for non-media file extensions to their MIME types. */
export const EXTRA_EXT_TO_MIME: Record<string, string> = {
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  xml: 'application/xml',
  zip: 'application/zip',
  gz: 'application/gzip',
  json: 'application/json',
  txt: 'text/plain',
};

/** Mappings for common media extensions to their MIME types. */
export const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  flv: 'video/x-flv',
  wmv: 'video/x-ms-wmv',
  pdf: 'application/pdf',
  txt: 'text/plain',
  json: 'application/json',
};

/** Reverse mapping of MIME types to their primary file extensions. */
export const MIME_TO_EXT: Record<string, string> = Object.fromEntries([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
  ['image/tiff', 'tiff'],
  ['image/bmp', 'bmp'],
  ['audio/mpeg', 'mp3'],
  ['audio/wav', 'wav'],
  ['audio/flac', 'flac'],
  ['audio/aac', 'aac'],
  ['audio/ogg', 'ogg'],
  ['audio/mp4', 'm4a'],
  ['video/mp4', 'mp4'],
  ['video/x-msvideo', 'avi'],
  ['video/quicktime', 'mov'],
  ['video/x-matroska', 'mkv'],
  ['video/webm', 'webm'],
  ['video/x-flv', 'flv'],
  ['video/x-ms-wmv', 'wmv'],
  ['application/pdf', 'pdf'],
  ['text/plain', 'txt'],
  ['application/json', 'json'],
]) as Record<string, string>;

// ============================================================================
// Magic Number Signatures
// ============================================================================

/**
 * File signature (magic number) definitions for server-side validation.
 * Used to verify file types regardless of the claimed extension.
 */
export const MAGIC_NUMBERS: Array<{
  offset: number;
  signature: number[];
  ext: string;
  mime: string;
}> = [
  { offset: 0, signature: [0xff, 0xd8, 0xff], ext: 'jpg', mime: 'image/jpeg' },
  {
    offset: 0,
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ext: 'png',
    mime: 'image/png',
  },
  { offset: 0, signature: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], ext: 'gif', mime: 'image/gif' },
  { offset: 0, signature: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], ext: 'gif', mime: 'image/gif' },
  { offset: 0, signature: [0x42, 0x4d], ext: 'bmp', mime: 'image/bmp' },
  { offset: 0, signature: [0x52, 0x49, 0x46, 0x46], ext: 'webp', mime: 'image/webp' },
  { offset: 0, signature: [0xff, 0xfb], ext: 'mp3', mime: 'audio/mpeg' },
  { offset: 0, signature: [0xff, 0xf3], ext: 'mp3', mime: 'audio/mpeg' },
  { offset: 0, signature: [0xff, 0xf2], ext: 'mp3', mime: 'audio/mpeg' },
  { offset: 0, signature: [0x49, 0x44, 0x33], ext: 'mp3', mime: 'audio/mpeg' },
  { offset: 0, signature: [0x52, 0x49, 0x46, 0x46], ext: 'wav', mime: 'audio/wav' },
  { offset: 0, signature: [0x4f, 0x67, 0x67, 0x53], ext: 'ogg', mime: 'audio/ogg' },
  {
    offset: 0,
    signature: [0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41],
    ext: 'm4a',
    mime: 'audio/m4a',
  },
  {
    offset: 0,
    signature: [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70],
    ext: 'mp4',
    mime: 'video/mp4',
  },
  {
    offset: 0,
    signature: [0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70],
    ext: 'mp4',
    mime: 'video/mp4',
  },
  { offset: 0, signature: [0x1a, 0x45, 0xdf, 0xa3], ext: 'webm', mime: 'video/webm' },
  { offset: 0, signature: [0x46, 0x4c, 0x56, 0x01], ext: 'flv', mime: 'video/x-flv' },
  { offset: 0, signature: [0x25, 0x50, 0x44, 0x46], ext: 'pdf', mime: 'application/pdf' },
];

// ============================================================================
// Storage & File Purpose
// ============================================================================

/** Supported storage backends. */
export const STORAGE_PROVIDERS = ['local', 's3', 'gcs'] as const;
/** Defined purposes for uploaded files to determine routing and security. */
export const FILE_PURPOSES = ['avatar', 'document', 'export', 'attachment', 'other'] as const;

/** Maximum image file size in bytes (5MB). */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/** Maximum logo file size in bytes (2MB). */
export const MAX_LOGO_SIZE = 2 * 1024 * 1024;

// ============================================================================
// Media Processing Limits & Defaults
// ============================================================================

/** Default maximum file size for media processing (100MB) */
export const DEFAULT_MAX_MEDIA_FILE_SIZE = 100 * 1024 * 1024;

/** Maximum audio file size for full-buffer metadata parsing (200MB) */
export const MAX_AUDIO_FILE_SIZE = 200 * 1024 * 1024;

/** Maximum buffer size for FFmpeg stdout/stderr accumulation (10MB) */
export const MAX_BUFFER_SIZE = 10 * 1024 * 1024;

/** File size threshold above which streaming should be used (10MB) */
export const STREAMING_THRESHOLD = 10 * 1024 * 1024;

/** Maximum allowed dimension (width or height) for image/video processing */
export const MAX_DIMENSION = 65_536;

/** Default processing timeout (5 minutes) */
export const DEFAULT_PROCESSING_TIMEOUT_MS = 5 * 60_000;

/** FFprobe metadata extraction timeout (30 seconds) */
export const FFPROBE_TIMEOUT_MS = 30 * 1000;

/** Maximum age for temp files before cleanup (24 hours) */
export const TEMP_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Retention time for completed/failed jobs (1 hour) */
export const JOB_RETENTION_MS = 60 * 60 * 1000;

/** Interval between cleanup runs for stale jobs/retry states (5 minutes) */
export const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** Default number of concurrent processing jobs */
export const DEFAULT_CONCURRENCY = 3;

/** Default maximum retry attempts */
export const DEFAULT_MAX_RETRIES = 3;

/** Default base delay between retries in milliseconds */
export const DEFAULT_RETRY_DELAY_MS = 1000;

/** Default JPEG/WebP quality (0-100) */
export const DEFAULT_IMAGE_QUALITY = 85;

/** Default PNG compression level (0-9) */
export const DEFAULT_PNG_COMPRESSION = 6;

/** Default thumbnail dimension in pixels */
export const DEFAULT_THUMBNAIL_SIZE = 300;

/** Upload chunk size for multipart transfer */
export const MAX_CHUNK_SIZE = 10 * 1024 * 1024;

/** Maximum filename length */
export const MAX_FILENAME_LENGTH = 255;

/** Maximum accepted upload file size (1GB) */
export const MAX_UPLOAD_FILE_SIZE = 1000 * 1024 * 1024;

/** Upload timeout (1 hour) */
export const MAX_UPLOAD_TIMEOUT_MS = 60 * 60 * 1000;
