// main/kernel/server/src/http/mime.ts

const EXTRA_EXT_TO_MIME: Readonly<Record<string, string>> = {
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

const EXT_TO_MIME: Readonly<Record<string, string>> = {
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

/**
 * Resolve MIME type for a file path or filename, defaulting to `application/octet-stream`.
 */
export function getMimeType(filePath: string): string {
  const parts = filePath.split('.');
  const ext = parts.length > 1 ? (parts.pop()?.toLowerCase() ?? '') : '';

  if (ext === '') return 'application/octet-stream';

  return EXTRA_EXT_TO_MIME[ext] ?? EXT_TO_MIME[ext] ?? 'application/octet-stream';
}
