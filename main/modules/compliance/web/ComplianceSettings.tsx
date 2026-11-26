// main/modules/compliance/web/ComplianceSettings.tsx
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type RefObject,
} from 'react';

import { useAuth } from '@bslt/identity/web';
import { useIsMobile, useLocalStorageValue } from '@bslt/react/hooks';
import { useNavigate } from '@bslt/react/router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Heading,
  Select,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@bslt/ui';
import { AsyncBoundary } from '@bslt/ui/components';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import { AnonymousDoNotSellControl } from './AnonymousDoNotSellControl';
import { fromServerConsent, toServerConsent, type ConsentDecision } from './consent/model';
import { hydrateConsent, readConsent, subscribeConsent, writeConsent } from './consent/store';
import {
  useAgeAssuranceStatus,
  useConsent,
  useCurrentLegal,
  useDataExport,
  useStartAgeAssurance,
  useTosStatus,
  useUpdateConsent,
  useUserAgreements,
  type ExportStatus,
  type UpdateConsentInput,
} from './hooks';

import type { DataExportFormat, LegalDocumentItem, UserAgreementItem } from '../contract';

const MS_PER_DAY = 86_400_000;
const BANNER_DISMISSED_KEY = 'cookie-consent-dismissed';
const DO_NOT_SELL_ANCHOR = 'do-not-sell';
const DB_PUBLISHED_TYPES: ReadonlySet<string> = new Set(['terms_of_service', 'privacy_policy']);

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function serverSnapshot(): null {
  return null;
}

export interface CookieConsentBannerProps {
  className?: string;
}

export const CookieConsentBanner = ({
  className,
}: CookieConsentBannerProps): ReactElement | null => {
  const t = useModuleMessages(enUsMessages);
  const isMobile = useIsMobile();
  const [dismissed, setDismissed] = useLocalStorageValue(BANNER_DISMISSED_KEY);
  const navigate = useNavigate();
  const { updateConsent } = useUpdateConsent();
  const { user } = useAuth();
  const visible = dismissed !== 'true';

  const decide = useCallback(
    (status: 'granted' | 'denied'): void => {
      const decision = writeConsent({ analytics: status, ads: status });
      if (user !== null) {
        void updateConsent(toServerConsent(decision)).catch(() => false);
      }
      setDismissed('true');
    },
    [updateConsent, user, setDismissed],
  );

  if (!visible) return null;

  return (
    <div
      className={`flex-shrink-0 bg-surface border-t p-4 flex ${
        isMobile ? 'flex-col gap-3' : 'items-center justify-between gap-4'
      } ${className ?? ''}`}
      role="banner"
      aria-label={t('compliance.banner.ariaLabel')}
      data-testid="cookie-consent-banner"
    >
      <Text size="sm">{t('compliance.banner.copy')}</Text>
      <div className={`flex gap-2 flex-shrink-0 ${isMobile ? 'flex-col' : ''}`}>
        <Button
          type="button"
          variant="text"
          size="small"
          onClick={() => {
            decide('denied');
            navigate('/settings#data-controls');
          }}
        >
          {t('compliance.banner.manage')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="small"
          onClick={() => {
            decide('denied');
          }}
        >
          {t('compliance.banner.reject')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="small"
          onClick={() => {
            decide('granted');
          }}
        >
          {t('compliance.banner.accept')}
        </Button>
      </div>
    </div>
  );
};

export interface DoNotSellControlProps {
  compact?: boolean;
  className?: string;
  anonymous?: boolean;
}

const DoNotSellAccountMirror = ({
  syncRef,
}: {
  readonly syncRef: RefObject<((decision: ConsentDecision) => void) | null>;
}): null => {
  const { updateConsent } = useUpdateConsent();
  syncRef.current = (decision: ConsentDecision): void => {
    void updateConsent(toServerConsent(decision)).catch(() => false);
  };
  useEffect(() => {
    return (): void => {
      syncRef.current = null;
    };
  }, [syncRef]);
  return null;
};

const DoNotSellAuthenticatedControl = ({
  compact = false,
  className,
}: Omit<DoNotSellControlProps, 'anonymous'>): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const consent = useSyncExternalStore(subscribeConsent, readConsent, serverSnapshot);
  const { user } = useAuth();
  const syncRef = useRef<((decision: ConsentDecision) => void) | null>(null);
  const optedOut = consent?.ads === 'denied';

  const handleToggle = useCallback(
    (nextOptedOut: boolean): void => {
      const decision = writeConsent({ ads: nextOptedOut ? 'denied' : 'granted' });
      if (user !== null) {
        syncRef.current?.(decision);
      }
    },
    [user],
  );

  const rootClassName = ['settings-toggle-row flex items-center justify-between gap-3', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName} id={DO_NOT_SELL_ANCHOR} data-testid="do-not-sell-control">
      {user !== null ? <DoNotSellAccountMirror syncRef={syncRef} /> : null}
      <div className="settings-toggle-row__content">
        <label htmlFor="do-not-sell-switch">
          <Text className="font-medium">{t('compliance.cpra.label')}</Text>
        </label>
        {!compact && (
          <Text tone="muted" size="sm">
            {t('compliance.cpra.description')}
          </Text>
        )}
      </div>
      <Switch
        id="do-not-sell-switch"
        checked={optedOut}
        onChange={handleToggle}
        aria-label={t('compliance.cpra.label')}
      />
    </div>
  );
};

export const DoNotSellControl = ({
  compact = false,
  className,
  anonymous = false,
}: DoNotSellControlProps): ReactElement =>
  anonymous ? (
    <AnonymousDoNotSellControl
      compact={compact}
      {...(className !== undefined ? { className } : {})}
    />
  ) : (
    <DoNotSellAuthenticatedControl
      compact={compact}
      {...(className !== undefined ? { className } : {})}
    />
  );

interface ConsentCategoryItem {
  readonly key: 'analytics' | 'marketing_email' | 'third_party_sharing' | 'profiling';
  readonly labelKey: keyof typeof enUsMessages;
  readonly descKey: keyof typeof enUsMessages;
}

const CONSENT_CATEGORY_ITEMS: readonly ConsentCategoryItem[] = [
  {
    key: 'analytics',
    labelKey: 'compliance.consent.analyticsLabel',
    descKey: 'compliance.consent.analyticsDesc',
  },
  {
    key: 'marketing_email',
    labelKey: 'compliance.consent.marketingLabel',
    descKey: 'compliance.consent.marketingDesc',
  },
  {
    key: 'third_party_sharing',
    labelKey: 'compliance.consent.sharingLabel',
    descKey: 'compliance.consent.sharingDesc',
  },
  {
    key: 'profiling',
    labelKey: 'compliance.consent.profilingLabel',
    descKey: 'compliance.consent.profilingDesc',
  },
] as const;

export const ConsentPreferences = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const { preferences, isLoading, error: fetchError, refetch } = useConsent();
  const { updateConsent, isUpdating, error: updateError } = useUpdateConsent();
  const [formValues, setFormValues] = useState<UpdateConsentInput>({});

  useEffect(() => {
    if (preferences !== null) hydrateConsent(fromServerConsent(preferences));
  }, [preferences]);

  const getCurrentValue = (key: ConsentCategoryItem['key']): boolean => {
    if (formValues[key] !== undefined) {
      return formValues[key] ?? false;
    }
    return preferences?.[key] ?? false;
  };

  const handleSave = async (): Promise<void> => {
    try {
      const result = await updateConsent(formValues);
      hydrateConsent(fromServerConsent(result.preferences));
      setFormValues({});
      await refetch();
    } catch {
      return;
    }
  };

  const hasChanges = Object.keys(formValues).length > 0;
  const error = fetchError ?? updateError;

  if (isLoading) {
    return (
      <AsyncBoundary
        variant="card"
        isLoading={true}
        loadingFallback={<Text>{t('compliance.consent.loading')}</Text>}
      />
    );
  }

  return (
    <div className="settings-consent">
      <div className="settings-consent__header">
        <Heading as="h4" size="sm" className="mb-1">
          {t('compliance.consent.heading')}
        </Heading>
        <Text tone="muted" size="sm">
          {t('compliance.consent.description')}
        </Text>
      </div>

      {error !== null && (
        <Alert tone="danger" data-testid="consent-error">
          {error.message}
        </Alert>
      )}

      <div className="settings-consent__list">
        {CONSENT_CATEGORY_ITEMS.map((category) => (
          <div key={category.key} className="settings-toggle-row settings-toggle-row--bordered">
            <div className="settings-toggle-row__content">
              <label htmlFor={`consent-${category.key}`}>
                <Text className="font-medium">{t(category.labelKey)}</Text>
              </label>
              <Text tone="muted" size="sm">
                {t(category.descKey)}
              </Text>
            </div>
            <Switch
              id={`consent-${category.key}`}
              checked={getCurrentValue(category.key)}
              onChange={(checked) => {
                setFormValues((prev) => ({ ...prev, [category.key]: checked }));
              }}
              disabled={isUpdating}
            />
          </div>
        ))}
      </div>

      <div className="settings-consent__actions">
        <Button
          onClick={() => {
            void handleSave();
          }}
          disabled={!hasChanges || isUpdating}
          data-testid="consent-save-button"
        >
          {isUpdating ? t('compliance.consent.saving') : t('compliance.consent.save')}
        </Button>
      </div>
    </div>
  );
};

export interface DataExportSectionProps {
  className?: string;
}

function getExportStatusTone(status: ExportStatus): 'success' | 'warning' | 'info' {
  switch (status) {
    case 'ready':
      return 'success';
    case 'pending':
      return 'warning';
    default:
      return 'info';
  }
}

export const DataExportSection = ({ className }: DataExportSectionProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const {
    exportInfo,
    isLoading,
    error,
    requestExport,
    isRequesting,
    requestError,
    downloadExport,
    isDownloading,
  } = useDataExport();
  const [format, setFormat] = useState<DataExportFormat>('json');

  const currentError = error ?? requestError;
  const status = exportInfo?.status ?? 'none';
  const hasPendingExport = status === 'pending';
  const hasReadyExport = status === 'ready';
  const rootClassName =
    className === undefined ? 'settings-data-export' : `settings-data-export ${className}`.trim();

  if (isLoading) {
    return (
      <section className={rootClassName}>
        <Text tone="muted">{t('compliance.export.loading')}</Text>
      </section>
    );
  }

  const statusLabel =
    status === 'pending'
      ? t('compliance.export.statusProcessing')
      : status === 'ready'
        ? t('compliance.export.statusReady')
        : status === 'expired'
          ? t('compliance.export.statusExpired')
          : t('compliance.export.statusNone');

  const pendingMessage =
    hasPendingExport && exportInfo !== null
      ? `${t('compliance.export.pendingBase')}${
          exportInfo.estimatedReadyAt !== null
            ? t('compliance.export.pendingReadyAt').replace(
                '{date}',
                formatTimestamp(exportInfo.estimatedReadyAt),
              )
            : ''
        }${
          exportInfo.requestedAt !== null
            ? t('compliance.export.pendingRequestedAt').replace(
                '{date}',
                formatTimestamp(exportInfo.requestedAt),
              )
            : ''
        }`
      : '';

  const readyMessage =
    hasReadyExport && exportInfo !== null
      ? `${t('compliance.export.readyBase')}${
          exportInfo.expiresAt !== null
            ? t('compliance.export.readyExpiresAt').replace(
                '{date}',
                formatTimestamp(exportInfo.expiresAt),
              )
            : ''
        }`
      : '';

  return (
    <section className={rootClassName} data-testid="data-export-section">
      <div className="settings-action-panel__header">
        <div className="settings-action-panel__copy">
          <Heading as="h4" size="sm">
            {t('compliance.export.heading')}
          </Heading>
          <Text size="sm" tone="muted">
            {t('compliance.export.description')}
          </Text>
        </div>
        {status !== 'none' && (
          <Badge tone={getExportStatusTone(status)} data-testid="export-status-badge">
            {statusLabel}
          </Badge>
        )}
      </div>

      {currentError !== null && (
        <Alert tone="danger" data-testid="export-error">
          {currentError.message}
        </Alert>
      )}

      {hasPendingExport && exportInfo !== null && (
        <Alert tone="info" data-testid="export-pending-alert">
          {pendingMessage}
        </Alert>
      )}

      {hasReadyExport && exportInfo !== null && (
        <Alert tone="success" data-testid="export-ready-alert">
          {readyMessage}
        </Alert>
      )}

      {status === 'expired' && (
        <Alert tone="warning" data-testid="export-expired-alert">
          {t('compliance.export.expiredAlert')}
        </Alert>
      )}

      <div className="settings-action-panel__actions">
        {hasReadyExport && (
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              void downloadExport().catch(() => false);
            }}
            disabled={isDownloading}
            data-testid="download-export-button"
          >
            {isDownloading ? t('compliance.export.downloading') : t('compliance.export.download')}
          </Button>
        )}
        <Select
          value={format}
          onChange={(value) => {
            setFormat(value as DataExportFormat);
          }}
          disabled={isRequesting || hasPendingExport}
          aria-label={t('compliance.export.formatAria')}
          data-testid="export-format-select"
        >
          <option value="json">{t('compliance.export.formatJson')}</option>
          <option value="csv">{t('compliance.export.formatCsv')}</option>
        </Select>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void requestExport(format);
          }}
          disabled={isRequesting || hasPendingExport}
          data-testid="request-export-button"
        >
          {isRequesting
            ? t('compliance.export.requesting')
            : hasPendingExport
              ? t('compliance.export.inProgress')
              : t('compliance.export.request')}
        </Button>
      </div>
    </section>
  );
};

export interface DataControlsSectionProps {
  accountStatus?: 'active' | 'deactivated' | 'pending_deletion';
  deletionScheduledAt?: string;
  className?: string;
}

const AgeAssuranceSection = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const { status, isLoading, error, refresh } = useAgeAssuranceStatus();
  const { startCheck, isSubmitting, error: submitError } = useStartAgeAssurance();
  const [confirmed, setConfirmed] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleConfirm = async (): Promise<void> => {
    if (!confirmed || status === null) return;
    setSuccessMessage(null);
    await startCheck({
      confirmed: true,
      method: 'attestation',
      threshold: status.minimumAge,
    });
    setConfirmed(false);
    setSuccessMessage(t('compliance.ageAssurance.successMessage'));
    await refresh();
  };

  if (isLoading) {
    return (
      <section className="settings-action-panel" aria-label={t('compliance.ageAssurance.loading')}>
        <Skeleton width="10rem" height="1.25rem" />
        <Skeleton width="100%" height="2.5rem" />
      </section>
    );
  }

  if (error !== null || status === null) {
    return (
      <section className="settings-action-panel">
        <Text className="font-medium">{t('compliance.ageAssurance.heading')}</Text>
        {error !== null ? <Alert tone="danger">{error.message}</Alert> : null}
      </section>
    );
  }

  const isVerified = status.ageVerifiedFor !== null && status.ageVerifiedFor >= status.minimumAge;
  const badgeTone = !status.serviceAvailable
    ? 'danger'
    : isVerified
      ? 'success'
      : status.requiresAgeAssurance
        ? 'warning'
        : 'info';
  const badgeLabel = !status.serviceAvailable
    ? t('compliance.ageAssurance.badgeUnavailable')
    : isVerified
      ? t('compliance.ageAssurance.badgeVerified').replace('{age}', String(status.ageVerifiedFor))
      : status.requiresAgeAssurance
        ? t('compliance.ageAssurance.badgeRequired')
        : t('compliance.ageAssurance.badgeOptional');

  const summary = t('compliance.ageAssurance.summary')
    .replace(
      '{jurisdiction}',
      status.jurisdiction ?? t('compliance.ageAssurance.jurisdictionDefault'),
    )
    .replace('{minimumAge}', String(status.minimumAge));

  return (
    <section className="settings-action-panel" data-testid="age-assurance-section">
      <div className="settings-action-panel__header">
        <div className="settings-action-panel__copy">
          <Text className="font-medium">{t('compliance.ageAssurance.heading')}</Text>
          <Text size="sm" tone="muted">
            {t('compliance.ageAssurance.description')}
          </Text>
          <Text size="xs" tone="muted">
            {summary}
          </Text>
        </div>
        <Badge tone={badgeTone}>{badgeLabel}</Badge>
      </div>

      {!status.serviceAvailable ? (
        <Alert tone="danger">{t('compliance.ageAssurance.unavailableCopy')}</Alert>
      ) : null}

      {submitError !== null ? <Alert tone="danger">{submitError.message}</Alert> : null}
      {successMessage !== null ? <Alert tone="success">{successMessage}</Alert> : null}

      {status.serviceAvailable && !isVerified ? (
        <div className="flex flex-col gap-3">
          <Checkbox
            checked={confirmed}
            onChange={(checked) => {
              setConfirmed(checked);
            }}
            label={t('compliance.ageAssurance.attestLabel').replace(
              '{minimumAge}',
              String(status.minimumAge),
            )}
          />
          <div className="settings-action-panel__actions">
            <Button
              type="button"
              size="small"
              disabled={!confirmed || isSubmitting}
              onClick={() => {
                void handleConfirm();
              }}
            >
              {isSubmitting
                ? t('compliance.ageAssurance.submittingButton')
                : t('compliance.ageAssurance.submitButton')}
            </Button>
          </div>
        </div>
      ) : null}

      {status.checks.length > 0 ? (
        <Text size="xs" tone="muted">
          {t('compliance.ageAssurance.historyCount').replace(
            '{count}',
            String(status.checks.length),
          )}
        </Text>
      ) : null}
    </section>
  );
};

export const DataControlsSection = ({
  accountStatus = 'active',
  deletionScheduledAt,
  className,
}: DataControlsSectionProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [now] = useState(() => Date.now());
  const deletionDaysLeft = useMemo(() => {
    if (deletionScheduledAt === undefined) return null;
    return Math.max(0, Math.ceil((new Date(deletionScheduledAt).getTime() - now) / MS_PER_DAY));
  }, [deletionScheduledAt, now]);

  const rootClassName =
    className === undefined ? 'settings-data-controls' : `settings-data-controls ${className}`;

  const statusTone =
    accountStatus === 'deactivated'
      ? 'warning'
      : accountStatus === 'pending_deletion'
        ? 'danger'
        : 'success';

  const statusLabel =
    accountStatus === 'active'
      ? t('compliance.dataControls.badgeActive')
      : accountStatus === 'deactivated'
        ? t('compliance.dataControls.badgeDeactivated')
        : t('compliance.dataControls.badgePendingDeletion');

  const statusCopy =
    accountStatus === 'active'
      ? t('compliance.dataControls.statusActiveCopy')
      : accountStatus === 'deactivated'
        ? t('compliance.dataControls.statusDeactivatedCopy')
        : t('compliance.dataControls.statusDeletionCopy');

  return (
    <div className={rootClassName}>
      <section className="settings-action-panel settings-action-panel--status">
        <div className="settings-action-panel__header">
          <div className="settings-action-panel__copy">
            <Text className="font-medium">{t('compliance.dataControls.statusHeading')}</Text>
            <Text size="sm" tone="muted">
              {statusCopy}
            </Text>
          </div>
          <Badge tone={statusTone} data-testid="account-status-badge">
            {statusLabel}
          </Badge>
        </div>
        {accountStatus === 'pending_deletion' && deletionDaysLeft !== null && (
          <Text size="sm" tone="danger" data-testid="deletion-countdown">
            {(deletionDaysLeft === 1
              ? t('compliance.dataControls.countdownDay')
              : t('compliance.dataControls.countdownDays')
            ).replace('{days}', String(deletionDaysLeft))}
          </Text>
        )}
      </section>

      <div className="settings-data-controls__group">
        <ConsentPreferences />
      </div>

      <div className="settings-data-controls__group">
        <DoNotSellControl />
      </div>

      <div className="settings-data-controls__group">
        <DataExportSection />
      </div>

      <div className="settings-data-controls__group">
        <AgeAssuranceSection />
      </div>
    </div>
  );
};

function findAgreementForDocument(
  document: LegalDocumentItem,
  agreements: readonly UserAgreementItem[],
): UserAgreementItem | null {
  return agreements.find((agreement) => agreement.documentId === document.id) ?? null;
}

export const LegalDocumentsSection = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const currentLegal = useCurrentLegal();
  const userAgreements = useUserAgreements();
  const tosStatus = useTosStatus();

  const isLoading = currentLegal.isLoading || userAgreements.isLoading || tosStatus.isLoading;
  const error = currentLegal.error ?? userAgreements.error ?? tosStatus.error ?? null;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton height="1.5rem" width="9rem" />
        <Skeleton height="5rem" className="w-full rounded-md" />
        <Skeleton height="5rem" className="w-full rounded-md" />
      </div>
    );
  }

  if (error !== null) {
    return <Alert tone="danger">{error.message}</Alert>;
  }

  const documents = currentLegal.documents.filter((document) =>
    DB_PUBLISHED_TYPES.has(document.type),
  );
  const agreements = userAgreements.agreements;
  const tosStatusData = tosStatus.status;
  const hasPublishedTos = tosStatusData !== null && typeof tosStatusData.documentId === 'string';
  const tosAccepted = hasPublishedTos && tosStatusData.accepted;
  const tosBadgeTone = tosAccepted ? 'success' : hasPublishedTos ? 'warning' : 'info';
  const tosBadgeLabel = tosAccepted
    ? t('compliance.legalSettings.badgeAccepted')
    : hasPublishedTos
      ? t('compliance.legalSettings.badgeActionRequired')
      : t('compliance.legalSettings.badgeNotPublished');
  const tosDescription = hasPublishedTos
    ? t('compliance.legalSettings.requiredVersion').replace(
        '{version}',
        String(tosStatusData.requiredVersion ?? '-'),
      )
    : t('compliance.legalSettings.notPublishedCopy');

  return (
    <div className="space-y-4">
      <Card>
        <Card.Body>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Heading as="h4" size="sm">
                {t('compliance.legalSettings.termsHeading')}
              </Heading>
              <Text size="sm" tone="muted">
                {tosDescription}
              </Text>
            </div>
            <Badge tone={tosBadgeTone}>{tosBadgeLabel}</Badge>
          </div>
        </Card.Body>
      </Card>

      {documents.length === 0 ? (
        <EmptyState
          title={t('compliance.legalSettings.emptyTitle')}
          description={t('compliance.legalSettings.emptyDesc')}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('compliance.tableDocument')}</TableHead>
              <TableHead>{t('compliance.tableVersion')}</TableHead>
              <TableHead>{t('compliance.tableEffective')}</TableHead>
              <TableHead>{t('compliance.legalSettings.colAgreement')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((document) => {
              const agreement = findAgreementForDocument(document, agreements);
              const versionText = t('compliance.versionBadge').replace(
                '{version}',
                String(document.version),
              );
              return (
                <TableRow key={document.id}>
                  <TableCell>
                    <Text size="sm">{document.title}</Text>
                    <Text size="xs" tone="muted" className="font-mono">
                      {document.type}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text size="sm">{versionText}</Text>
                  </TableCell>
                  <TableCell>
                    <Text size="sm">{formatTimestamp(document.effectiveAt)}</Text>
                  </TableCell>
                  <TableCell>
                    {agreement !== null ? (
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone="success">{t('compliance.legalSettings.badgeAccepted')}</Badge>
                        <Text size="xs" tone="muted">
                          {formatTimestamp(agreement.agreedAt)}
                        </Text>
                      </div>
                    ) : (
                      <Badge tone="warning">{t('compliance.legalSettings.badgeNotAccepted')}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
};
