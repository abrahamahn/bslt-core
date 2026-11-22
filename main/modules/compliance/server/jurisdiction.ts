// main/modules/compliance/server/jurisdiction.ts
const JURISDICTION_CODE_REGEX = /^[A-Z]{2}(?:-[A-Z0-9]{1,8})?$/u;
const SENTINEL_CODES = new Set(['XX', 'ZZ', 'T1', 'A1', 'A2', 'O1']);

const EDGE_GEO_HEADERS = [
  'x-bslt-jurisdiction',
  'cf-ipcountry',
  'x-vercel-ip-country',
  'x-country-code',
] as const;

interface JurisdictionResolveInput {
  readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>> | undefined;
  readonly declaredCountry?: string | null | undefined;
}

export interface JurisdictionResolver {
  resolve(input: JurisdictionResolveInput): string | null;
}

function normalizeJurisdictionCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.trim().toUpperCase();
  if (normalized.length === 0 || SENTINEL_CODES.has(normalized)) {
    return null;
  }
  if (!JURISDICTION_CODE_REGEX.test(normalized)) {
    return null;
  }
  return normalized;
}

function extractHeaderValue(
  headers: Readonly<Record<string, string | readonly string[] | undefined>> | undefined,
  name: string,
): string | null {
  if (headers === undefined) {
    return null;
  }
  const val = headers[name];
  const str: string | undefined =
    typeof val === 'string' ? val : val !== undefined ? val[0] : undefined;
  return normalizeJurisdictionCode(str);
}

export function createDefaultJurisdictionResolver(
  defaultJurisdiction?: string,
): JurisdictionResolver {
  const normalizedDefault = normalizeJurisdictionCode(defaultJurisdiction);

  return {
    resolve(input: JurisdictionResolveInput): string | null {
      for (const headerName of EDGE_GEO_HEADERS) {
        const fromHeader = extractHeaderValue(input.headers, headerName);
        if (fromHeader !== null) {
          return fromHeader;
        }
      }
      const fromDeclared = normalizeJurisdictionCode(input.declaredCountry);
      if (fromDeclared !== null) {
        return fromDeclared;
      }
      return normalizedDefault;
    },
  };
}
