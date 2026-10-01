// main/shared/src/modules/system/http/multipart.ts
/**
 * Multipart parsing utilities.
 *
 * Framework-agnostic helpers that parse a multipart/form-data payload and
 * normalize the first file part into a predictable shape.
 *
 * Uses only platform-agnostic APIs (Uint8Array, TextDecoder) so it works in
 * both Node.js and browser environments.
 */

export interface ParsedMultipartFile {
  buffer: Uint8Array;
  mimetype: string;
  filename: string;
  originalName: string;
  size: number;
}

function extractBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const value = match?.[1] ?? match?.[2];
  if (value === undefined || value.trim() === '') return null;
  return value.trim();
}

function parseHeaders(headerBlock: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of headerBlock.split('\r\n')) {
    const sep = line.indexOf(':');
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    headers[key] = value;
  }
  return headers;
}

function parseContentDispositionFilename(contentDisposition: string): string | null {
  const fileNameMatch = contentDisposition.match(/filename="([^"]*)"/i);
  const fileNameStarMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  const raw = fileNameMatch?.[1] ?? fileNameStarMatch?.[1];
  if (raw === undefined) return null;
  const decoded = raw.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return decoded;
}

/**
 * Find all byte positions of `needle` inside `haystack`.
 * Returns the index of the first byte of each match.
 */
function findAllOccurrences(haystack: Uint8Array, needle: Uint8Array): number[] {
  const positions: number[] = [];
  if (needle.length === 0 || haystack.length < needle.length) return positions;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    positions.push(i);
  }
  return positions;
}

const ASCII = new TextEncoder();
const CRLF = new Uint8Array([0x0d, 0x0a]); // \r\n
const CRLFCRLF = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]); // \r\n\r\n

export function parseMultipartFile(
  bodyBuffer: Uint8Array,
  contentType: string,
): ParsedMultipartFile | null {
  const boundary = extractBoundary(contentType);
  if (boundary === null) return null;

  const boundaryBytes = ASCII.encode(`--${boundary}`);
  const boundaryPositions = findAllOccurrences(bodyBuffer, boundaryBytes);

  // Need at least two boundary markers (opening + closing)
  if (boundaryPositions.length < 2) return null;

  for (let b = 0; b < boundaryPositions.length - 1; b++) {
    const bPos = boundaryPositions[b] ?? 0;
    const bNext = boundaryPositions[b + 1] ?? bodyBuffer.length;
    const partStart = bPos + boundaryBytes.length;
    const partEnd = bNext;

    // Skip boundary suffix: optional "--" (final), then CRLF
    let cursor = partStart;
    if (
      cursor + 1 < bodyBuffer.length &&
      bodyBuffer[cursor] === 0x2d &&
      bodyBuffer[cursor + 1] === 0x2d
    ) {
      break; // closing boundary "--"
    }
    if (
      cursor + 1 < bodyBuffer.length &&
      bodyBuffer[cursor] === 0x0d &&
      bodyBuffer[cursor + 1] === 0x0a
    ) {
      cursor += 2; // skip the CRLF after boundary line
    }

    const partSlice = bodyBuffer.subarray(cursor, partEnd);

    // Find header/body separator: \r\n\r\n
    const separatorPositions = findAllOccurrences(partSlice, CRLFCRLF);
    if (separatorPositions.length === 0) continue;
    const separatorIndex = separatorPositions[0] ?? 0;

    // Headers are ASCII — safe to decode as UTF-8
    const headerBytes = partSlice.subarray(0, separatorIndex);
    const headerText = new TextDecoder('utf-8').decode(headerBytes);
    const headers = parseHeaders(headerText);

    const contentDisposition = headers['content-disposition'] ?? '';
    const filename = parseContentDispositionFilename(contentDisposition);
    if (filename === null || filename === '') continue;

    const mimetype = headers['content-type'] ?? 'application/octet-stream';

    // Body is raw bytes — slice directly, no string conversion
    const bodyStart = separatorIndex + CRLFCRLF.length;
    let bodyEnd = partSlice.length;

    // Strip trailing CRLF added by the multipart framing
    if (
      bodyEnd >= bodyStart + CRLF.length &&
      partSlice[bodyEnd - 2] === 0x0d &&
      partSlice[bodyEnd - 1] === 0x0a
    ) {
      bodyEnd -= 2;
    }

    const fileBuffer = new Uint8Array(
      partSlice.buffer,
      partSlice.byteOffset + bodyStart,
      bodyEnd - bodyStart,
    );

    return {
      buffer: fileBuffer,
      mimetype,
      filename,
      originalName: filename,
      size: fileBuffer.length,
    };
  }

  return null;
}
