// main/modules/identity/web/IdentitySecuritySettings.tsx
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
} from 'react';

import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  FormField,
  Heading,
  Input,
  PasswordInput,
  Skeleton,
  Text,
} from '@bslt/ui';
import { AsyncBoundary } from '@bslt/ui/components';
import { useModuleMessages } from '@bslt/web-platform';

import {
  validatePasswordBasic,
  type OAuthConnectionItem,
  type OAuthProvider,
  type PasskeyListItem,
  type User,
} from '../contract';
import enUsMessages from '../i18n/en-US.json';

import {
  useBackupCodes,
  useChangeEmail,
  useEnabledAuthStrategies,
  useEnabledOAuthProviders,
  useForgotPassword,
  useOAuthConnections,
  usePasskeys,
  usePasswordChange,
  usePhone,
  useRegisterPasskey,
  useSetPassword,
  useTotpManagement,
} from './hooks';
import { formatInternationalPhoneInput, normalizeInternationalPhoneInput } from './phoneFormatting';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ============================================================================
// TotpQrCode
// ============================================================================

export interface TotpQrCodeProps {
  url: string;
  size?: number;
}

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

function initGaloisField(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = x << 1;
    if (x >= 256) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255] ?? 0;
  }
}

initGaloisField();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  const logA = GF_LOG[a] ?? 0;
  const logB = GF_LOG[b] ?? 0;
  return GF_EXP[(logA + logB) % 255] ?? 0;
}

function rsGeneratorPoly(nsym: number): Uint8Array {
  let g = new Uint8Array([1]);
  for (let i = 0; i < nsym; i++) {
    const next = new Uint8Array(g.length + 1);
    const factor = GF_EXP[i] ?? 0;
    for (let j = 0; j < g.length; j++) {
      next[j] = ((next[j] ?? 0) ^ (g[j] ?? 0)) >>> 0;
      next[j + 1] = ((next[j + 1] ?? 0) ^ gfMul(g[j] ?? 0, factor)) >>> 0;
    }
    g = next;
  }
  return g;
}

function rsEncode(data: Uint8Array, nsym: number): Uint8Array {
  const gen = rsGeneratorPoly(nsym);
  const out = new Uint8Array(data.length + nsym);
  out.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = out[i] ?? 0;
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        out[i + j] = ((out[i + j] ?? 0) ^ gfMul(gen[j] ?? 0, coef)) >>> 0;
      }
    }
  }
  return out.slice(data.length);
}

const VERSION_PARAMS: Record<number, [number, number, number]> = {
  1: [26, 19, 7],
  2: [44, 34, 10],
  3: [70, 55, 15],
  4: [100, 80, 20],
  5: [134, 108, 26],
  6: [172, 136, 36],
  7: [196, 156, 40],
  8: [242, 194, 48],
  9: [292, 232, 60],
  10: [346, 274, 72],
};

function selectVersion(dataLen: number): number {
  for (let v = 1; v <= 10; v++) {
    const params = VERSION_PARAMS[v];
    if (params === undefined) continue;
    const lengthBits = v <= 9 ? 8 : 16;
    const available = params[1] * 8 - 4 - lengthBits;
    if (dataLen * 8 <= available) return v;
  }
  return 10;
}

function createQrMatrix(data: string): boolean[][] | null {
  try {
    const bytes = new TextEncoder().encode(data);
    const version = selectVersion(bytes.length);
    const params = VERSION_PARAMS[version];
    if (params === undefined) return null;

    const [, dataCw, ecCw] = params;
    const size = 17 + version * 4;

    const bits: number[] = [];
    const pushBits = (val: number, count: number): void => {
      for (let i = count - 1; i >= 0; i--) {
        bits.push((val >> i) & 1);
      }
    };

    pushBits(0b0100, 4);
    pushBits(bytes.length, version <= 9 ? 8 : 16);
    for (const b of bytes) pushBits(b, 8);
    pushBits(0, Math.min(4, dataCw * 8 - bits.length));

    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = new Uint8Array(dataCw);
    let cwIdx = 0;
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0);
      if (cwIdx < dataCw) codewords[cwIdx++] = byte;
    }

    const padBytes = [0xec, 0x11];
    let padIdx = 0;
    while (cwIdx < dataCw) {
      codewords[cwIdx++] = padBytes[padIdx % 2] ?? 0;
      padIdx++;
    }

    const ecBytes = rsEncode(codewords, ecCw);
    const allCodewords = new Uint8Array(codewords.length + ecBytes.length);
    allCodewords.set(codewords);
    allCodewords.set(ecBytes, codewords.length);

    const matrixFlat = new Array<boolean | null>(size * size).fill(null);
    const matrixGet = (r: number, c: number): boolean | null => matrixFlat[r * size + c] ?? null;
    const matrixSet = (r: number, c: number, val: boolean): void => {
      matrixFlat[r * size + c] = val;
    };

    const placeFinderPattern = (row: number, col: number): void => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const mr = row + r;
          const mc = col + c;
          if (mr < 0 || mr >= size || mc < 0 || mc >= size) continue;
          const isBlack =
            (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          matrixSet(mr, mc, isBlack);
        }
      }
    };

    placeFinderPattern(0, 0);
    placeFinderPattern(0, size - 7);
    placeFinderPattern(size - 7, 0);

    for (let i = 8; i < size - 8; i++) {
      matrixSet(6, i, i % 2 === 0);
      matrixSet(i, 6, i % 2 === 0);
    }

    matrixSet(size - 8, 8, true);

    if (version >= 2) {
      const alignPos = [6, size - 7];
      if (version >= 7) alignPos.splice(1, 0, Math.floor((size - 13) / 2) + 6);

      for (const ar of alignPos) {
        for (const ac of alignPos) {
          if (matrixGet(ar, ac) !== null) continue;
          for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
              const isBlack = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
              if (ar + r >= 0 && ar + r < size && ac + c >= 0 && ac + c < size) {
                matrixSet(ar + r, ac + c, isBlack);
              }
            }
          }
        }
      }
    }

    for (let i = 0; i < 8; i++) {
      if (matrixGet(8, i) === null) matrixSet(8, i, false);
      if (matrixGet(i, 8) === null) matrixSet(i, 8, false);
      if (matrixGet(8, size - 1 - i) === null) matrixSet(8, size - 1 - i, false);
      if (matrixGet(size - 1 - i, 8) === null) matrixSet(size - 1 - i, 8, false);
    }
    if (matrixGet(8, 8) === null) matrixSet(8, 8, false);

    let bitIdx = 0;
    const allBits: number[] = [];
    for (const cw of allCodewords) {
      for (let b = 7; b >= 0; b--) allBits.push((cw >> b) & 1);
    }

    let col = size - 1;
    let upward = true;
    while (col >= 0) {
      if (col === 6) col--;
      const rows = upward
        ? Array.from({ length: size }, (_, i) => size - 1 - i)
        : Array.from({ length: size }, (_, i) => i);

      for (const row of rows) {
        for (const dc of [0, -1]) {
          const c = col + dc;
          if (c < 0 || c >= size) continue;
          if (matrixGet(row, c) !== null) continue;
          matrixSet(row, c, bitIdx < allBits.length ? (allBits[bitIdx] ?? 0) === 1 : false);
          bitIdx++;
        }
      }

      col -= 2;
      upward = !upward;
    }

    const FORMAT_INFO_MASK0 = 0b111011111000100;
    const result: boolean[][] = Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    );

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const val = matrixGet(r, c) ?? false;
        const isMask = (r + c) % 2 === 0;
        const isFunction =
          (r < 9 && c < 9) ||
          (r < 9 && c >= size - 8) ||
          (r >= size - 8 && c < 9) ||
          r === 6 ||
          c === 6;
        const row = result[r];
        if (row !== undefined) {
          row[c] = isFunction ? val : val !== isMask;
        }
      }
    }

    const formatBits: boolean[] = [];
    for (let i = 14; i >= 0; i--) {
      formatBits.push(((FORMAT_INFO_MASK0 >> i) & 1) === 1);
    }

    const setBit = (r: number, c: number, fIdx: number): void => {
      const row = result[r];
      if (row !== undefined) {
        row[c] = formatBits[fIdx] ?? false;
      }
    };

    let fIdx = 0;
    for (let c = 0; c <= 7; c++) {
      if (c === 6) continue;
      setBit(8, c, fIdx++);
    }
    setBit(8, 7, fIdx++);
    setBit(8, 8, fIdx++);
    for (let c = size - 7; c < size; c++) {
      setBit(8, c, fIdx++);
    }

    fIdx = 0;
    for (let r = 0; r <= 7; r++) {
      if (r === 6) continue;
      setBit(r, 8, fIdx++);
    }
    setBit(7, 8, fIdx++);
    setBit(8, 8, fIdx++);
    for (let r = size - 7; r < size; r++) {
      setBit(r, 8, fIdx++);
    }

    return result;
  } catch {
    return null;
  }
}

export function TotpQrCode({ url, size = 200 }: TotpQrCodeProps): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    canvas.style.width = `${String(size)}px`;
    canvas.style.height = `${String(size)}px`;

    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      queueMicrotask(() => {
        setRenderError(true);
      });
      return;
    }

    const matrix = createQrMatrix(url);
    if (matrix === null) {
      queueMicrotask(() => {
        setRenderError(true);
      });
      return;
    }

    const moduleCount = matrix.length;
    const moduleSize = Math.floor(size / (moduleCount + 2));
    const actualSize = moduleSize * (moduleCount + 2);

    canvas.width = actualSize;
    canvas.height = actualSize;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, actualSize, actualSize);

    ctx.fillStyle = '#000000';
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (matrix[row]?.[col] === true) {
          ctx.fillRect((col + 1) * moduleSize, (row + 1) * moduleSize, moduleSize, moduleSize);
        }
      }
    }

    queueMicrotask(() => {
      setRenderError(false);
    });
  }, [url, size]);

  if (renderError) {
    return (
      <Text size="sm" tone="muted">
        {t('identity.totp.qrFallback')}
      </Text>
    );
  }

  return <canvas ref={canvasRef} />;
}

// ============================================================================
// TotpManagement
// ============================================================================

export interface TotpManagementProps {
  onStatusChange?: (enabled: boolean) => void;
}

export const TotpManagement = ({ onStatusChange }: TotpManagementProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const { state, error, isLoading, setupData, beginSetup, enable, disable, cancelSetup } =
    useTotpManagement();
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedBackupCodes, setCopiedBackupCodes] = useState(false);

  const handleEnable = async (e: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    await enable(verifyCode);
    setVerifyCode('');
    onStatusChange?.(true);
  };

  const handleDisable = async (e: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    await disable(disableCode);
    setDisableCode('');
    setShowDisableForm(false);
    onStatusChange?.(false);
  };

  const copyToClipboard = async (text: string, type: 'secret' | 'backup'): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'secret') {
        setCopiedSecret(true);
        setTimeout(() => {
          setCopiedSecret(false);
        }, 2000);
      } else {
        setCopiedBackupCodes(true);
        setTimeout(() => {
          setCopiedBackupCodes(false);
        }, 2000);
      }
    } catch {
      setCopiedSecret(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="space-y-3">
        <Skeleton height="1.25rem" width="12rem" />
        <Skeleton height="2.5rem" width="8rem" />
      </div>
    );
  }

  if (state === 'setup-in-progress' && setupData !== null) {
    return (
      <div className="space-y-4">
        <Text size="sm" tone="muted">
          {t('identity.totp.setupIntro')}
        </Text>

        {'otpauthUrl' in setupData && setupData.otpauthUrl !== '' ? (
          <div className="space-y-2">
            <Text size="sm" tone="muted" className="font-medium">
              {t('identity.totp.qrLabel')}
            </Text>
            <div className="inline-block p-4 bg-primary rounded-lg border">
              <TotpQrCode url={setupData.otpauthUrl} size={200} />
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <Text size="sm" tone="muted" className="font-medium">
            {t('identity.totp.secretLabel')}
          </Text>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-surface rounded text-sm font-mono break-all select-all">
              {setupData.secret}
            </code>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void copyToClipboard(setupData.secret, 'secret');
              }}
            >
              {copiedSecret ? t('identity.totp.copied') : t('identity.totp.copy')}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Text size="sm" tone="muted" className="font-medium">
            {t('identity.totp.backupCodesLabel')}
          </Text>
          <Text size="xs" tone="muted">
            {t('identity.totp.backupCodesHint')}
          </Text>
          <div className="grid grid-cols-2 gap-1 px-3 py-2 bg-surface rounded">
            {setupData.backupCodes.map((code) => (
              <code key={code} className="text-sm font-mono">
                {code}
              </code>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void copyToClipboard(setupData.backupCodes.join('\n'), 'backup');
            }}
          >
            {copiedBackupCodes ? t('identity.totp.copied') : t('identity.totp.copyAllCodes')}
          </Button>
        </div>

        <form
          onSubmit={(e) => {
            void handleEnable(e);
          }}
          className="space-y-3 border-t pt-4"
        >
          <Input.Field
            label={t('identity.totp.verificationCodeLabel')}
            type="text"
            value={verifyCode}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setVerifyCode(e.target.value);
            }}
            placeholder={t('identity.totp.codePlaceholder')}
            maxLength={8}
            autoComplete="one-time-code"
            disabled={isLoading}
            required
          />

          {error !== null ? <Alert tone="danger">{error}</Alert> : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={isLoading || verifyCode.length < 6}>
              {isLoading ? t('identity.totp.verifying') : t('identity.totp.enableAction')}
            </Button>
            <Button type="button" variant="secondary" onClick={cancelSetup} disabled={isLoading}>
              {t('identity.totp.cancelAction')}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  if (state === 'enabled') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="status-dot bg-success" />
          <Text size="sm" className="font-medium text-success">
            {t('identity.totp.enabledStatus')}
          </Text>
        </div>

        {showDisableForm ? (
          <form
            onSubmit={(e) => {
              void handleDisable(e);
            }}
            className="space-y-3"
          >
            <Input.Field
              label={t('identity.totp.disableCodeLabel')}
              type="text"
              value={disableCode}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setDisableCode(e.target.value);
              }}
              placeholder={t('identity.totp.codePlaceholder')}
              maxLength={8}
              autoComplete="one-time-code"
              disabled={isLoading}
              required
            />

            {error !== null ? <Alert tone="danger">{error}</Alert> : null}

            <div className="flex gap-2">
              <Button
                type="submit"
                variant="secondary"
                disabled={isLoading || disableCode.length < 6}
              >
                {isLoading ? t('identity.totp.disabling') : t('identity.totp.disableAction')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowDisableForm(false);
                  setDisableCode('');
                }}
                disabled={isLoading}
              >
                {t('identity.totp.cancelAction')}
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setShowDisableForm(true);
            }}
          >
            {t('identity.totp.disableAction')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="status-dot text-muted bg-current" />
        <Text size="sm" tone="muted">
          {t('identity.totp.disabledStatus')}
        </Text>
      </div>

      <Text size="sm" tone="muted">
        {t('identity.totp.disabledDescription')}
      </Text>

      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      <Button
        type="button"
        onClick={() => {
          void beginSetup();
        }}
        disabled={isLoading}
      >
        {isLoading ? t('identity.totp.settingUp') : t('identity.totp.enableAction')}
      </Button>
    </div>
  );
};

// ============================================================================
// BackupCodesDisplay
// ============================================================================

export interface BackupCodesDisplayProps {
  className?: string;
}

export const BackupCodesDisplay = ({ className }: BackupCodesDisplayProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const { status, isLoading, isRegenerating, newCodes, error, regenerate, dismissCodes } =
    useBackupCodes();
  const [confirmCode, setConfirmCode] = useState('');
  const [showRegenerateForm, setShowRegenerateForm] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  const handleRegenerate = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await regenerate(confirmCode);
    setConfirmCode('');
    setShowRegenerateForm(false);
  };

  const handleCopyAll = async (): Promise<void> => {
    if (newCodes === null) return;
    try {
      await navigator.clipboard.writeText(newCodes.join('\n'));
      setCopiedCodes(true);
      setTimeout(() => {
        setCopiedCodes(false);
      }, 2000);
    } catch {
      setCopiedCodes(false);
    }
  };

  const handleDismissCodes = (): void => {
    setCopiedCodes(false);
    dismissCodes();
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <Card.Body>
          <div className="space-y-3">
            <Skeleton height="1.25rem" width="12rem" />
            <Skeleton height="1rem" width="8rem" />
          </div>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <Card.Body>
        <div className="space-y-4">
          <div>
            <Heading as="h4" size="sm" className="mb-2">
              {t('identity.backupCodes.heading')}
            </Heading>
            <Text size="sm" tone="muted">
              {t('identity.backupCodes.subtitle')}
            </Text>
          </div>

          {status !== null ? (
            <div
              className="flex items-center gap-3 p-3 bg-surface rounded border"
              data-testid="backup-codes-status"
            >
              {status.total === 0 ? (
                <Text size="sm" tone="muted">
                  {t('identity.backupCodes.noneGenerated')}
                </Text>
              ) : (
                <div className="flex flex-col">
                  <Text size="sm" className="font-medium">
                    {t('identity.backupCodes.remainingCount', {
                      remaining: String(status.remaining),
                      total: String(status.total),
                    })}
                  </Text>
                  <Text size="sm" tone="muted">
                    {status.remaining === 0
                      ? t('identity.backupCodes.exhaustedWarning')
                      : status.remaining <= 2
                        ? t('identity.backupCodes.lowWarning')
                        : t('identity.backupCodes.availableBody')}
                  </Text>
                </div>
              )}
            </div>
          ) : null}

          {newCodes !== null ? (
            <div className="space-y-3" data-testid="new-codes-display">
              <Alert tone="warning">
                <Text size="sm" className="font-medium">
                  {t('identity.backupCodes.saveNowWarning')}
                </Text>
              </Alert>

              <div className="grid grid-cols-2 gap-1 px-3 py-2 bg-surface rounded border">
                {newCodes.map((code) => (
                  <code key={code} className="text-sm font-mono">
                    {code}
                  </code>
                ))}
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    void handleCopyAll();
                  }}
                  data-testid="copy-codes-button"
                >
                  {copiedCodes
                    ? t('identity.backupCodes.copied')
                    : t('identity.backupCodes.copyAllAction')}
                </Button>
                <Button
                  type="button"
                  variant="text"
                  onClick={handleDismissCodes}
                  data-testid="dismiss-codes-button"
                >
                  {t('identity.backupCodes.savedAction')}
                </Button>
              </div>
            </div>
          ) : null}

          {error !== null ? <Alert tone="danger">{error}</Alert> : null}

          {newCodes === null && !showRegenerateForm ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowRegenerateForm(true);
              }}
              disabled={isRegenerating}
              data-testid="regenerate-button"
            >
              {t('identity.backupCodes.regenerateAction')}
            </Button>
          ) : null}

          {showRegenerateForm && newCodes === null ? (
            <div className="border-t pt-4">
              <Alert tone="warning">
                <Text size="sm">{t('identity.backupCodes.invalidateWarning')}</Text>
              </Alert>
              <form
                onSubmit={(event) => {
                  void handleRegenerate(event);
                }}
                className="mt-3 space-y-3"
              >
                <Input.Field
                  label={t('identity.backupCodes.confirmCodeLabel')}
                  type="text"
                  value={confirmCode}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setConfirmCode(event.target.value);
                  }}
                  placeholder={t('identity.backupCodes.confirmCodePlaceholder')}
                  maxLength={16}
                  autoComplete="one-time-code"
                  disabled={isRegenerating}
                  required
                  data-testid="confirm-code-input"
                />

                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={isRegenerating || confirmCode.length < 6}
                    data-testid="confirm-regenerate-button"
                  >
                    {isRegenerating
                      ? t('identity.backupCodes.regenerating')
                      : t('identity.backupCodes.confirmRegenerateAction')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setShowRegenerateForm(false);
                      setConfirmCode('');
                    }}
                    disabled={isRegenerating}
                  >
                    {t('identity.backupCodes.cancelAction')}
                  </Button>
                </div>
              </form>
            </div>
          ) : null}
        </div>
      </Card.Body>
    </Card>
  );
};

// ============================================================================
// PasskeyManagement
// ============================================================================

interface PasskeyRowProps {
  passkey: PasskeyListItem;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const PasskeyRow = ({ passkey, onRename, onDelete }: PasskeyRowProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(passkey.name);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSave = useCallback(async () => {
    if (editName.trim() === '' || editName === passkey.name) {
      setIsEditing(false);
      return;
    }
    await onRename(passkey.id, editName.trim());
    setIsEditing(false);
  }, [editName, onRename, passkey.id, passkey.name]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditName(passkey.name);
  }, [passkey.name]);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await onDelete(passkey.id);
    } finally {
      setIsDeleting(false);
    }
  }, [onDelete, passkey.id]);

  const deviceLabel =
    passkey.deviceType === 'multiDevice'
      ? t('identity.passkeys.syncedBadge')
      : passkey.deviceType === 'singleDevice'
        ? t('identity.passkeys.deviceBoundBadge')
        : t('identity.passkeys.defaultBadge');

  const metaText =
    passkey.lastUsedAt !== null
      ? t('identity.passkeys.createdAndLastUsed', {
          created: formatDateTime(passkey.createdAt),
          lastUsed: formatDateTime(passkey.lastUsedAt),
        })
      : t('identity.passkeys.createdOnly', { created: formatDateTime(passkey.createdAt) });

  return (
    <Card className="p-4 flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <Input
              value={editName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setEditName(e.target.value);
              }}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSave();
                } else if (e.key === 'Escape') {
                  handleCancel();
                }
              }}
              className="flex-1"
            />
            <Button
              size="small"
              onClick={() => {
                void handleSave();
              }}
            >
              {t('identity.passkeys.saveAction')}
            </Button>
            <Button size="small" variant="secondary" onClick={handleCancel}>
              {t('identity.passkeys.cancelAction')}
            </Button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2">
              <Text>{passkey.name}</Text>
              <Badge tone={passkey.backedUp ? 'success' : 'neutral'}>{deviceLabel}</Badge>
            </div>
            <Text size="sm" className="text-muted">
              {metaText}
            </Text>
          </div>
        )}
      </div>

      {!isEditing ? (
        <div className="flex items-center gap-2">
          <Button
            size="small"
            variant="secondary"
            onClick={() => {
              setIsEditing(true);
            }}
          >
            {t('identity.passkeys.renameAction')}
          </Button>
          <Button
            size="small"
            variant="secondary"
            onClick={() => {
              void handleDelete();
            }}
            disabled={isDeleting}
            className="text-danger"
          >
            {isDeleting ? t('identity.passkeys.deleting') : t('identity.passkeys.deleteAction')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
};

const PasskeyList = ({ className }: { className?: string | undefined }): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const { passkeys, isLoading, error, refetch, rename, remove } = usePasskeys();
  const {
    register,
    isLoading: isRegistering,
    error: registerError,
  } = useRegisterPasskey(() => {
    void refetch();
  });

  if (isLoading) {
    return (
      <div className={className}>
        <Skeleton height="4rem" className="mb-2" />
        <Skeleton height="4rem" />
      </div>
    );
  }

  return (
    <div className={className}>
      {error !== null ? (
        <Text tone="danger" className="mb-4">
          {error}
        </Text>
      ) : null}
      {registerError !== null && registerError !== error ? (
        <Text tone="danger" className="mb-4">
          {registerError}
        </Text>
      ) : null}

      <div className="flex flex-col gap-3 mb-4">
        {passkeys.length === 0 ? (
          <Text className="text-muted">{t('identity.passkeys.empty')}</Text>
        ) : (
          passkeys.map((pk) => (
            <PasskeyRow key={pk.id} passkey={pk} onRename={rename} onDelete={remove} />
          ))
        )}
      </div>

      <Button
        onClick={() => {
          void register();
        }}
        disabled={isRegistering}
      >
        {isRegistering ? t('identity.passkeys.registering') : t('identity.passkeys.addAction')}
      </Button>
    </div>
  );
};

export interface PasskeyManagementProps {
  className?: string;
}

export function PasskeyManagement({ className }: PasskeyManagementProps): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const strategyState = useEnabledAuthStrategies();

  const isSupported = typeof window !== 'undefined' && 'PublicKeyCredential' in window;
  if (!isSupported) {
    return (
      <div className={className}>
        <Text className="text-muted">{t('identity.passkeys.unsupportedBrowser')}</Text>
      </div>
    );
  }

  if (strategyState.isLoading) {
    return (
      <div className={className}>
        <Skeleton height="4rem" />
      </div>
    );
  }

  const webauthnEnabled =
    strategyState.error === null && strategyState.enabled.includes('webauthn');
  if (!webauthnEnabled) {
    return (
      <div className={`flex flex-col gap-1 ${className ?? ''}`}>
        <Text className="text-muted">{t('identity.passkeys.serverDisabled')}</Text>
        <Text size="sm" className="text-muted">
          {t('identity.passkeys.serverDisabledHint')}
        </Text>
      </div>
    );
  }

  return <PasskeyList className={className} />;
}

// ============================================================================
// PhoneManagement
// ============================================================================

export interface PhoneManagementProps {
  user: User;
  baseUrl?: string;
  getToken?: () => string | null;
  onStatusChange?: () => void;
}

export const PhoneManagement = ({ user, onStatusChange }: PhoneManagementProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const { isLoading, error, setPhone, verifyPhone, removePhone } = usePhone();

  const [phone, setPhoneInput] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'idle' | 'verify' | 'success'>('idle');
  const [localError, setLocalError] = useState<string | null>(null);

  const phoneValue = typeof user.phone === 'string' ? user.phone : '';
  const hasPhone = phoneValue !== '';
  const isVerified = user.phoneVerified === true;

  const maskedPhone = hasPhone ? `***${phoneValue.slice(-4)}` : null;

  const handleSetPhone = useCallback(async () => {
    const normalizedPhone = normalizeInternationalPhoneInput(phone);
    if (normalizedPhone === '') return;
    setLocalError(null);
    try {
      await setPhone(normalizedPhone);
      setStep('verify');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t('identity.phone.setFailed'));
    }
  }, [phone, setPhone, t]);

  const handleVerify = useCallback(async () => {
    if (code.trim().length < 6) return;
    setLocalError(null);
    try {
      await verifyPhone(code.trim());
      setStep('success');
      onStatusChange?.();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t('identity.phone.verifyFailed'));
    }
  }, [code, verifyPhone, onStatusChange, t]);

  const handleRemove = useCallback(async () => {
    setLocalError(null);
    try {
      await removePhone();
      setStep('idle');
      setPhoneInput('');
      setCode('');
      onStatusChange?.();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t('identity.phone.removeFailed'));
    }
  }, [removePhone, onStatusChange, t]);

  const displayError = localError ?? (error !== null ? error.message : null);

  if (isVerified) {
    return (
      <Card className="settings-phone-card">
        <div className="settings-phone-card__header">
          <div>
            <div className="flex items-center gap-2">
              <Text>{t('identity.phone.verifiedHeading')}</Text>
              <Badge tone="success">{t('identity.phone.verifiedBadge')}</Badge>
            </div>
            <Text tone="muted" size="sm">
              {maskedPhone}
            </Text>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={() => {
              void handleRemove();
            }}
            disabled={isLoading}
          >
            {t('identity.phone.removeAction')}
          </Button>
        </div>
        {displayError !== null ? (
          <Alert tone="danger" className="mt-3">
            {displayError}
          </Alert>
        ) : null}
      </Card>
    );
  }

  if (step === 'verify') {
    return (
      <Card className="settings-phone-card">
        <Text>{t('identity.phone.enterCodeHeading')}</Text>
        <Text tone="muted" size="sm">
          {t('identity.phone.enterCodeSubtitle')}
        </Text>
        <form
          className="settings-phone-card__form-row"
          onSubmit={(e) => {
            e.preventDefault();
            void handleVerify();
          }}
        >
          <Input
            type="text"
            placeholder={t('identity.phone.codePlaceholder')}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
            }}
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
          />
          <Button type="submit" disabled={isLoading || code.trim().length < 6}>
            {t('identity.phone.verifyAction')}
          </Button>
        </form>
        {displayError !== null ? <Alert tone="danger">{displayError}</Alert> : null}
      </Card>
    );
  }

  if (step === 'success') {
    return (
      <Card className="settings-phone-card">
        <Alert tone="success">{t('identity.phone.verifiedSuccess')}</Alert>
      </Card>
    );
  }

  return (
    <Card className="settings-phone-card">
      <Text>{t('identity.phone.idleHeading')}</Text>
      <Text tone="muted" size="sm">
        {t('identity.phone.idleDescription')}
      </Text>
      <form
        className="settings-phone-card__form-row"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSetPhone();
        }}
      >
        <Input
          type="tel"
          placeholder={t('identity.phone.phonePlaceholder')}
          value={phone}
          onChange={(e) => {
            setPhoneInput(formatInternationalPhoneInput(e.target.value));
          }}
          autoComplete="tel"
          inputMode="tel"
          maxLength={24}
        />
        <Button
          type="submit"
          disabled={isLoading || normalizeInternationalPhoneInput(phone) === ''}
        >
          {t('identity.phone.sendCodeAction')}
        </Button>
      </form>
      {displayError !== null ? <Alert tone="danger">{displayError}</Alert> : null}
    </Card>
  );
};

// ============================================================================
// EmailChangeForm
// ============================================================================

export interface EmailChangeFormProps {
  onSuccess?: () => void;
}

export const EmailChangeForm = ({ onSuccess }: EmailChangeFormProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const changeEmail = useChangeEmail();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
      e.preventDefault();
      setError(null);
      setSuccessMessage(null);
      setIsLoading(true);

      try {
        const result = await changeEmail({
          newEmail: newEmail.trim(),
          password,
        });

        setSuccessMessage(result.message);
        setNewEmail('');
        setPassword('');
        onSuccess?.();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t('identity.emailChange.failedFallback');
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [changeEmail, newEmail, password, onSuccess, t],
  );

  const isValid = newEmail.trim().length > 0 && newEmail.includes('@') && password.length > 0;

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      className="space-y-5"
    >
      <Text size="sm" tone="muted">
        {t('identity.emailChange.intro')}
      </Text>

      <FormField label={t('identity.emailChange.newEmailLabel')} htmlFor="newEmail" required>
        <Input
          id="newEmail"
          name="email"
          type="email"
          value={newEmail}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setNewEmail(e.target.value);
          }}
          placeholder={t('identity.emailChange.newEmailPlaceholder')}
          autoComplete="email"
          disabled={isLoading}
          required
        />
      </FormField>

      <FormField
        label={t('identity.emailChange.passwordLabel')}
        htmlFor="emailChangePassword"
        required
      >
        <PasswordInput
          id="emailChangePassword"
          name="current-password"
          value={password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setPassword(e.target.value);
          }}
          placeholder={t('identity.emailChange.passwordPlaceholder')}
          autoComplete="current-password"
          disabled={isLoading}
        />
      </FormField>

      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      {successMessage !== null && successMessage.length > 0 ? (
        <Alert tone="success">{successMessage}</Alert>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!isValid || isLoading}>
          {isLoading ? t('identity.emailChange.requesting') : t('identity.emailChange.submit')}
        </Button>
      </div>
    </form>
  );
};

// ============================================================================
// PasswordChangeForm
// ============================================================================

export interface PasswordChangeFormProps {
  onSuccess?: () => void;
}

export const PasswordChangeForm = ({ onSuccess }: PasswordChangeFormProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const { changePassword, isLoading, error, reset } = usePasswordChange({
    onSuccess: () => {
      setSuccessMessage(t('identity.passwordChange.success'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      reset();
      onSuccess?.();
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    },
  });

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setValidationError(null);
    setSuccessMessage(null);

    if (newPassword !== confirmPassword) {
      setValidationError(t('identity.passwordChange.mismatchError'));
      return;
    }

    const passwordValidation = validatePasswordBasic(newPassword);
    if (!passwordValidation.isValid) {
      setValidationError(passwordValidation.errors[0] ?? t('identity.passwordChange.invalidError'));
      return;
    }

    if (newPassword === currentPassword) {
      setValidationError(t('identity.passwordChange.sameAsCurrentError'));
      return;
    }

    changePassword({
      currentPassword,
      newPassword,
    });
  };

  const isValid =
    currentPassword.length > 0 &&
    validatePasswordBasic(newPassword).isValid &&
    confirmPassword.length > 0 &&
    newPassword === confirmPassword;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <FormField
        label={t('identity.passwordChange.currentLabel')}
        htmlFor="currentPassword"
        required
      >
        <PasswordInput
          id="currentPassword"
          name="current-password"
          value={currentPassword}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setCurrentPassword(e.target.value);
          }}
          placeholder={t('identity.passwordChange.currentPlaceholder')}
          autoComplete="current-password"
        />
      </FormField>

      <FormField label={t('identity.passwordChange.newLabel')} htmlFor="newPassword" required>
        <PasswordInput
          id="newPassword"
          name="new-password"
          value={newPassword}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setNewPassword(e.target.value);
          }}
          placeholder={t('identity.passwordChange.newPlaceholder')}
          autoComplete="new-password"
          showStrength
        />
      </FormField>

      <FormField
        label={t('identity.passwordChange.confirmLabel')}
        htmlFor="confirmPassword"
        required
      >
        <PasswordInput
          id="confirmPassword"
          name="confirm-password"
          value={confirmPassword}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setConfirmPassword(e.target.value);
          }}
          placeholder={t('identity.passwordChange.confirmPlaceholder')}
          autoComplete="new-password"
        />
        {confirmPassword.length > 0 && newPassword !== confirmPassword ? (
          <Text size="sm" tone="danger">
            {t('identity.passwordChange.inlineMismatch')}
          </Text>
        ) : null}
      </FormField>

      {validationError !== null || error !== null ? (
        <Alert tone="danger">{validationError ?? error?.message}</Alert>
      ) : null}

      {successMessage !== null && successMessage.length > 0 ? (
        <Alert tone="success">{successMessage}</Alert>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!isValid || isLoading}>
          {isLoading ? t('identity.passwordChange.changing') : t('identity.passwordChange.submit')}
        </Button>
      </div>
    </form>
  );
};

// ============================================================================
// PasswordSetupForm
// ============================================================================

export const PasswordSetupForm = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const setPasswordHook = useSetPassword();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (password !== confirmPassword) {
      setError(new Error(t('identity.passwordChange.inlineMismatch')));
      return;
    }

    const validation = validatePasswordBasic(password);
    if (!validation.isValid) {
      setError(new Error(validation.errors[0] ?? t('identity.passwordChange.invalidError')));
      return;
    }

    setIsLoading(true);
    try {
      const response = await setPasswordHook({ password });
      setMessage(response.message);
      setPassword('');
      setConfirmPassword('');
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setIsLoading(false);
    }
  };

  const canSubmit =
    password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
    >
      <Text tone="muted" size="sm">
        {t('identity.passwordSetup.intro')}
      </Text>

      <FormField label={t('identity.passwordSetup.passwordLabel')} htmlFor="setPassword" required>
        <PasswordInput
          id="setPassword"
          name="new-password"
          value={password}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setPassword(event.target.value);
          }}
          autoComplete="new-password"
          showStrength
        />
      </FormField>

      <FormField
        label={t('identity.passwordSetup.confirmLabel')}
        htmlFor="setPasswordConfirm"
        required
      >
        <PasswordInput
          id="setPasswordConfirm"
          name="confirm-password"
          value={confirmPassword}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setConfirmPassword(event.target.value);
          }}
          autoComplete="new-password"
        />
      </FormField>

      {error !== null ? <Alert tone="danger">{error.message}</Alert> : null}
      {message !== null ? <Alert tone="success">{message}</Alert> : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit || isLoading}>
          {isLoading ? t('identity.passwordSetup.setting') : t('identity.passwordSetup.submit')}
        </Button>
      </div>
    </form>
  );
};

// ============================================================================
// ForgotPasswordShortcut
// ============================================================================

export interface ForgotPasswordShortcutProps {
  email: string;
  onSuccess?: () => void;
}

export const ForgotPasswordShortcut = ({
  email,
  onSuccess,
}: ForgotPasswordShortcutProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const forgotPassword = useForgotPassword();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleRequestReset = useCallback(async (): Promise<void> => {
    if (email.trim().length === 0) return;

    setError(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      const result = await forgotPassword({ email: email.trim() });
      setSuccessMessage(result.message);
      onSuccess?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('identity.forgotShortcut.failedFallback');
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [email, forgotPassword, onSuccess, t]);

  const isValid = email.trim().length > 0 && email.includes('@');

  return (
    <div className="space-y-3">
      <Text size="sm" tone="muted">
        {t('identity.forgotShortcut.prefix')}
        <Text as="span" className="font-medium">
          {email}
        </Text>
        {t('identity.forgotShortcut.suffix')}
      </Text>

      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      {successMessage !== null && successMessage.length > 0 ? (
        <Alert tone="success">{successMessage}</Alert>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="button"
          disabled={!isValid || isLoading}
          onClick={() => {
            void handleRequestReset();
          }}
        >
          {isLoading ? t('identity.forgotShortcut.sending') : t('identity.forgotShortcut.submit')}
        </Button>
      </div>
    </div>
  );
};

// ============================================================================
// OAuthConnectionsList
// ============================================================================

export interface OAuthConnectionsListProps {
  onSuccess?: () => void;
}

const providerInfo = {
  google: { name: 'Google', icon: 'G' },
  github: { name: 'GitHub', icon: 'GH' },
  apple: { name: 'Apple', icon: '' },
} as const satisfies Record<OAuthProvider, { name: string; icon: string }>;

interface ProviderCardProps {
  provider: OAuthProvider;
  connected: boolean;
  connection: OAuthConnectionItem | null;
  onConnect: () => void;
  onDisconnect: () => void;
  isDisconnecting: boolean;
  isConnecting: boolean;
}

const ProviderCard = ({
  provider,
  connected,
  connection,
  onConnect,
  onDisconnect,
  isDisconnecting,
  isConnecting,
}: ProviderCardProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const info = providerInfo[provider];

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="settings-provider-icon">{info.icon}</div>
          <div>
            <Text className="font-medium">{info.name}</Text>
            {connected && connection !== null ? (
              <Text size="sm" tone="muted">
                {connection.providerEmail}
              </Text>
            ) : null}
          </div>
        </div>

        {connected ? (
          <Button
            variant="text"
            size="small"
            onClick={onDisconnect}
            disabled={isDisconnecting}
            className="text-danger"
          >
            {isDisconnecting
              ? t('identity.oauthSettings.disconnecting')
              : t('identity.oauthSettings.disconnectAction')}
          </Button>
        ) : (
          <Button variant="secondary" size="small" onClick={onConnect} disabled={isConnecting}>
            {isConnecting
              ? t('identity.oauthSettings.connecting')
              : t('identity.oauthSettings.connectAction')}
          </Button>
        )}
      </div>
    </Card>
  );
};

export const OAuthConnectionsList = ({ onSuccess }: OAuthConnectionsListProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<OAuthProvider | null>(null);

  const {
    providers: enabledProviders,
    isLoading: isLoadingProviders,
    error: providersError,
  } = useEnabledOAuthProviders();

  const {
    connections,
    isLoading: isLoadingConnections,
    isActing,
    error: connectionsError,
    unlink,
    link,
  } = useOAuthConnections();

  const handleConnect = async (provider: OAuthProvider): Promise<void> => {
    try {
      setLinkError(null);
      const url = await link(provider);
      window.location.assign(url);
    } catch (err) {
      const info = providerInfo[provider];
      setLinkError(
        err instanceof Error
          ? err.message
          : t('identity.oauthSettings.connectFailed', { provider: info.name }),
      );
    }
  };

  const confirmDisconnect = async (): Promise<void> => {
    const provider = pendingDisconnect;
    setPendingDisconnect(null);
    if (provider === null) return;

    const info = providerInfo[provider];
    try {
      setUnlinkError(null);
      await unlink(provider);
      onSuccess?.();
    } catch (err) {
      setUnlinkError(
        err instanceof Error
          ? err.message
          : t('identity.oauthSettings.disconnectFailed', { provider: info.name }),
      );
    }
  };

  if (isLoadingProviders || isLoadingConnections) {
    return (
      <AsyncBoundary
        variant="card"
        isLoading={true}
        loadingFallback={
          <div className="space-y-3">
            <Skeleton height="4rem" className="w-full" />
            <Skeleton height="4rem" className="w-full" />
            <Skeleton height="4rem" className="w-full" />
          </div>
        }
      />
    );
  }

  if (providersError !== null || connectionsError !== null) {
    const errorMessage =
      providersError?.message ?? connectionsError?.message ?? t('identity.oauthSettings.unknown');
    return (
      <AsyncBoundary
        variant="card"
        errorMessage={errorMessage}
        errorFallback={
          <Alert tone="danger">
            {t('identity.oauthSettings.loadFailed', { error: errorMessage })}
          </Alert>
        }
      />
    );
  }

  if (enabledProviders.length === 0) {
    return (
      <Text size="sm" tone="muted">
        {t('identity.oauthSettings.noneConfigured')}
      </Text>
    );
  }

  const providerList = enabledProviders.map((provider) => {
    const connection = connections.find((candidate) => candidate.provider === provider);
    return {
      provider,
      connected: connection !== undefined,
      connection,
    };
  });

  return (
    <div className="space-y-3">
      {unlinkError !== null && unlinkError.length > 0 ? (
        <Alert tone="danger">{unlinkError}</Alert>
      ) : null}
      {linkError !== null && linkError.length > 0 ? <Alert tone="danger">{linkError}</Alert> : null}

      {providerList.map(({ provider, connected, connection }) => (
        <ProviderCard
          key={provider}
          provider={provider}
          connected={connected}
          connection={connection ?? null}
          onConnect={() => {
            void handleConnect(provider);
          }}
          onDisconnect={() => {
            setPendingDisconnect(provider);
          }}
          isDisconnecting={isActing}
          isConnecting={isActing}
        />
      ))}

      {connections.length === 0 ? (
        <Text size="sm" tone="muted" className="text-center py-2">
          {t('identity.oauthSettings.connectPrompt')}
        </Text>
      ) : null}

      <Dialog.Root
        open={pendingDisconnect !== null}
        onClose={() => {
          setPendingDisconnect(null);
        }}
      >
        <Dialog.Header>
          <Dialog.Title>{t('identity.oauthSettings.dialogTitle')}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Dialog.Description>
            {pendingDisconnect !== null
              ? t('identity.oauthSettings.dialogBody', {
                  provider: providerInfo[pendingDisconnect].name,
                })
              : ''}
          </Dialog.Description>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setPendingDisconnect(null);
            }}
          >
            {t('identity.oauthSettings.cancelAction')}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              void confirmDisconnect();
            }}
          >
            {t('identity.oauthSettings.disconnectAction')}
          </Button>
        </Dialog.Footer>
      </Dialog.Root>
    </div>
  );
};
