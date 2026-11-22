// main/modules/compliance/web/ComplianceAdminPage.tsx
import { useMemo, useState, type ReactElement, type SyntheticEvent } from 'react';

import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Heading,
  Input,
  PageContainer,
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
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import {
  useEraseUserData,
  useLegalHolds,
  usePlaceLegalHold,
  useReleaseLegalHold,
  useUpsertJurisdictionRule,
} from './hooks';

import type { LegalHoldSubjectType, ListLegalHoldsQuery } from '../contract';

const SUBJECT_TYPES: readonly LegalHoldSubjectType[] = ['user', 'org', 'file', 'case', 'other'];

function isSubjectType(value: string): value is LegalHoldSubjectType {
  return SUBJECT_TYPES.some((candidate) => candidate === value);
}

export function ComplianceAdminPage(): ReactElement {
  const t = useModuleMessages(enUsMessages);

  // Legal holds filter + form state
  const [activeOnly, setActiveOnly] = useState(true);
  const [filterSubjectType, setFilterSubjectType] = useState<'all' | LegalHoldSubjectType>('all');
  const [subjectType, setSubjectType] = useState<LegalHoldSubjectType>('user');
  const [subjectId, setSubjectId] = useState('');
  const [reason, setReason] = useState('');
  const [heldUntil, setHeldUntil] = useState('');
  const [holdSuccess, setHoldSuccess] = useState<string | null>(null);

  // Jurisdiction rule form state
  const [jurisdictionCode, setJurisdictionCode] = useState('');
  const [minimumAge, setMinimumAge] = useState('13');
  const [requiresAgeAssurance, setRequiresAgeAssurance] = useState(false);
  const [serviceAvailable, setServiceAvailable] = useState(true);
  const [jurisdictionSuccess, setJurisdictionSuccess] = useState<string | null>(null);

  // GDPR user erasure state
  const [eraseUserId, setEraseUserId] = useState('');
  const [eraseConfirmed, setEraseConfirmed] = useState(false);
  const [eraseSuccess, setEraseSuccess] = useState<string | null>(null);

  const holdsQuery = useMemo<ListLegalHoldsQuery>(
    () => ({
      activeOnly: activeOnly ? 'true' : 'false',
      ...(filterSubjectType !== 'all' ? { subjectType: filterSubjectType } : {}),
    }),
    [activeOnly, filterSubjectType],
  );

  const holdsState = useLegalHolds(holdsQuery);
  const placeHoldState = usePlaceLegalHold();
  const releaseHoldState = useReleaseLegalHold();
  const jurisdictionState = useUpsertJurisdictionRule();
  const eraseState = useEraseUserData();

  const subjectTypeLabel = (type: LegalHoldSubjectType): string => {
    switch (type) {
      case 'user':
        return t('compliance.holds.subjectTypeUser');
      case 'org':
        return t('compliance.holds.subjectTypeOrg');
      case 'file':
        return t('compliance.holds.subjectTypeFile');
      case 'case':
        return t('compliance.holds.subjectTypeCase');
      case 'other':
        return t('compliance.holds.subjectTypeOther');
    }
  };

  const handlePlaceHold = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setHoldSuccess(null);
    const trimmedId = subjectId.trim();
    const trimmedReason = reason.trim();
    if (trimmedId === '' || trimmedReason.length < 3) return;

    await placeHoldState.placeHold({
      subjectType,
      subjectId: trimmedId,
      reason: trimmedReason,
      ...(heldUntil.trim() !== '' ? { heldUntil: new Date(heldUntil).toISOString() } : {}),
    });

    setHoldSuccess(
      t('compliance.holds.placedSuccess')
        .replace('{subjectType}', subjectTypeLabel(subjectType))
        .replace('{subjectId}', trimmedId),
    );
    setSubjectId('');
    setReason('');
    setHeldUntil('');
    await holdsState.refresh();
  };

  const handleReleaseHold = async (id: string): Promise<void> => {
    setHoldSuccess(null);
    await releaseHoldState.releaseHold(id);
    setHoldSuccess(t('compliance.holds.releasedSuccess'));
    await holdsState.refresh();
  };

  const handleSaveJurisdiction = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setJurisdictionSuccess(null);
    const trimmedCode = jurisdictionCode.trim().toUpperCase();
    const parsedAge = Number.parseInt(minimumAge, 10);
    if (trimmedCode.length < 2 || Number.isNaN(parsedAge) || parsedAge < 13 || parsedAge > 120) {
      return;
    }

    const result = await jurisdictionState.upsertRule({
      jurisdiction: trimmedCode,
      minimumAge: parsedAge,
      requiresAgeAssurance,
      serviceAvailable,
    });
    setJurisdictionSuccess(
      t('compliance.jurisdictions.savedSuccess')
        .replace('{jurisdiction}', result.rule.jurisdiction)
        .replace('{minimumAge}', String(result.rule.minimumAge)),
    );
  };

  const handleEraseUser = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setEraseSuccess(null);
    const trimmedUserId = eraseUserId.trim();
    if (trimmedUserId === '' || !eraseConfirmed) return;

    const result = await eraseState.eraseUser(trimmedUserId);
    setEraseSuccess(
      t('compliance.erasure.successMessage')
        .replace('{userId}', result.userId)
        .replace('{modules}', result.erasedModules.join(', ')),
    );
    setEraseUserId('');
    setEraseConfirmed(false);
  };

  return (
    <PageContainer>
      <div className="mb-6">
        <Heading as="h1">{t('compliance.adminComplianceTitle')}</Heading>
        <Text tone="muted" size="sm">
          {t('compliance.adminComplianceSubtitle')}
        </Text>
      </div>

      <div className="space-y-6">
        {/* 1. Legal Holds */}
        <Card>
          <Card.Body>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <Heading as="h2" size="md">
                  {t('compliance.holds.heading')}
                </Heading>
                <Text tone="muted" size="sm">
                  {t('compliance.holds.description')}
                </Text>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id="holds-active-only"
                    checked={activeOnly}
                    onChange={setActiveOnly}
                    aria-label={t('compliance.holds.activeOnlyLabel')}
                  />
                  <label htmlFor="holds-active-only" className="text-sm">
                    {t('compliance.holds.activeOnlyLabel')}
                  </label>
                </div>
                <Select
                  aria-label={t('compliance.holds.subjectTypeLabel')}
                  value={filterSubjectType}
                  onChange={(value: string) => {
                    if (value === 'all' || isSubjectType(value)) {
                      setFilterSubjectType(value);
                    }
                  }}
                >
                  <option value="all">{t('compliance.holds.subjectTypeAll')}</option>
                  {SUBJECT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {subjectTypeLabel(type)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {holdSuccess !== null ? (
              <Alert tone="success" className="mb-4">
                {holdSuccess}
              </Alert>
            ) : null}
            {placeHoldState.error !== null ? (
              <Alert tone="danger" className="mb-4">
                {placeHoldState.error.message}
              </Alert>
            ) : null}
            {releaseHoldState.error !== null ? (
              <Alert tone="danger" className="mb-4">
                {releaseHoldState.error.message}
              </Alert>
            ) : null}

            <form
              className="grid gap-3 mb-6"
              onSubmit={(event) => {
                void handlePlaceHold(event);
              }}
            >
              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="hold-subject-type" className="text-sm text-muted">
                    {t('compliance.holds.subjectTypeLabel')}
                  </label>
                  <Select
                    id="hold-subject-type"
                    value={subjectType}
                    onChange={(value: string) => {
                      if (isSubjectType(value)) setSubjectType(value);
                    }}
                  >
                    {SUBJECT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {subjectTypeLabel(type)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label htmlFor="hold-subject-id" className="text-sm text-muted">
                    {t('compliance.holds.subjectIdLabel')}
                  </label>
                  <Input
                    id="hold-subject-id"
                    value={subjectId}
                    onChange={(event) => {
                      setSubjectId(event.target.value);
                    }}
                    placeholder={t('compliance.holds.subjectIdPlaceholder')}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="hold-until" className="text-sm text-muted">
                    {t('compliance.holds.heldUntilLabel')}
                  </label>
                  <Input
                    id="hold-until"
                    type="datetime-local"
                    value={heldUntil}
                    onChange={(event) => {
                      setHeldUntil(event.target.value);
                    }}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="hold-reason" className="text-sm text-muted">
                  {t('compliance.holds.reasonLabel')}
                </label>
                <Input
                  id="hold-reason"
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                  placeholder={t('compliance.holds.reasonPlaceholder')}
                />
              </div>
              <div>
                <Button
                  type="submit"
                  disabled={
                    placeHoldState.isPlacing || subjectId.trim() === '' || reason.trim().length < 3
                  }
                >
                  {placeHoldState.isPlacing
                    ? t('compliance.holds.placingButton')
                    : t('compliance.holds.placeButton')}
                </Button>
              </div>
            </form>

            {holdsState.isLoading ? (
              <div className="space-y-2">
                <Skeleton height="2.5rem" className="w-full" />
                <Skeleton height="2.5rem" className="w-full" />
              </div>
            ) : holdsState.error !== null ? (
              <Alert tone="danger">{holdsState.error.message}</Alert>
            ) : holdsState.holds.length === 0 ? (
              <EmptyState
                title={t('compliance.holds.emptyTitle')}
                description={t('compliance.holds.emptyDesc')}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('compliance.holds.colSubject')}</TableHead>
                    <TableHead>{t('compliance.holds.colReason')}</TableHead>
                    <TableHead>{t('compliance.holds.colStatus')}</TableHead>
                    <TableHead>{t('compliance.holds.colActions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdsState.holds.map((hold) => {
                    const isActive = hold.releasedAt === null;
                    const subjectLabel = `${hold.subjectType}:${hold.subjectId}`;
                    return (
                      <TableRow key={hold.id}>
                        <TableCell>
                          <Text size="sm" className="font-mono">
                            {subjectLabel}
                          </Text>
                        </TableCell>
                        <TableCell>
                          <Text size="sm">{hold.reason}</Text>
                        </TableCell>
                        <TableCell>
                          <Badge tone={isActive ? 'warning' : 'info'}>
                            {isActive
                              ? t('compliance.holds.statusActive')
                              : t('compliance.holds.statusReleased')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {isActive ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="small"
                              disabled={releaseHoldState.isReleasing}
                              onClick={() => {
                                void handleReleaseHold(hold.id);
                              }}
                            >
                              {releaseHoldState.isReleasing
                                ? t('compliance.holds.releasingButton')
                                : t('compliance.holds.releaseButton')}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card.Body>
        </Card>

        {/* 2. Jurisdiction Rules */}
        <Card>
          <Card.Body>
            <Heading as="h2" size="md" className="mb-1">
              {t('compliance.jurisdictions.heading')}
            </Heading>
            <Text tone="muted" size="sm" className="mb-4">
              {t('compliance.jurisdictions.description')}
            </Text>

            {jurisdictionSuccess !== null ? (
              <Alert tone="success" className="mb-4">
                {jurisdictionSuccess}
              </Alert>
            ) : null}
            {jurisdictionState.error !== null ? (
              <Alert tone="danger" className="mb-4">
                {jurisdictionState.error.message}
              </Alert>
            ) : null}

            <form
              className="space-y-4"
              onSubmit={(event) => {
                void handleSaveJurisdiction(event);
              }}
            >
              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="jurisdiction-code" className="text-sm text-muted">
                    {t('compliance.jurisdictions.codeLabel')}
                  </label>
                  <Input
                    id="jurisdiction-code"
                    value={jurisdictionCode}
                    onChange={(event) => {
                      setJurisdictionCode(event.target.value);
                    }}
                    placeholder={t('compliance.jurisdictions.codePlaceholder')}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="jurisdiction-min-age" className="text-sm text-muted">
                    {t('compliance.jurisdictions.minimumAgeLabel')}
                  </label>
                  <Input
                    id="jurisdiction-min-age"
                    type="number"
                    min={13}
                    max={120}
                    value={minimumAge}
                    onChange={(event) => {
                      setMinimumAge(event.target.value);
                    }}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    id="jurisdiction-requires-age"
                    checked={requiresAgeAssurance}
                    onChange={setRequiresAgeAssurance}
                    aria-label={t('compliance.jurisdictions.requiresAgeAssuranceLabel')}
                  />
                  <label htmlFor="jurisdiction-requires-age" className="text-sm">
                    {t('compliance.jurisdictions.requiresAgeAssuranceLabel')}
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="jurisdiction-service-available"
                    checked={serviceAvailable}
                    onChange={setServiceAvailable}
                    aria-label={t('compliance.jurisdictions.serviceAvailableLabel')}
                  />
                  <label htmlFor="jurisdiction-service-available" className="text-sm">
                    {t('compliance.jurisdictions.serviceAvailableLabel')}
                  </label>
                </div>
              </div>
              <Button
                type="submit"
                disabled={jurisdictionState.isSaving || jurisdictionCode.trim().length < 2}
              >
                {jurisdictionState.isSaving
                  ? t('compliance.jurisdictions.savingButton')
                  : t('compliance.jurisdictions.saveButton')}
              </Button>
            </form>
          </Card.Body>
        </Card>

        {/* 3. GDPR User Erasure */}
        <Card>
          <Card.Body>
            <Heading as="h2" size="md" className="mb-1">
              {t('compliance.erasure.heading')}
            </Heading>
            <Text tone="muted" size="sm" className="mb-4">
              {t('compliance.erasure.description')}
            </Text>

            {eraseSuccess !== null ? (
              <Alert tone="success" className="mb-4">
                {eraseSuccess}
              </Alert>
            ) : null}
            {eraseState.error !== null ? (
              <Alert tone="danger" className="mb-4">
                {eraseState.error.message}
              </Alert>
            ) : null}

            <form
              className="space-y-4"
              onSubmit={(event) => {
                void handleEraseUser(event);
              }}
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="erase-user-id" className="text-sm text-muted">
                  {t('compliance.erasure.userIdLabel')}
                </label>
                <Input
                  id="erase-user-id"
                  value={eraseUserId}
                  onChange={(event) => {
                    setEraseUserId(event.target.value);
                  }}
                  placeholder={t('compliance.erasure.userIdPlaceholder')}
                />
              </div>
              <Checkbox
                checked={eraseConfirmed}
                onChange={setEraseConfirmed}
                label={t('compliance.erasure.confirmLabel')}
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={eraseState.isErasing || eraseUserId.trim() === '' || !eraseConfirmed}
              >
                {eraseState.isErasing
                  ? t('compliance.erasure.submittingButton')
                  : t('compliance.erasure.submitButton')}
              </Button>
            </form>
          </Card.Body>
        </Card>
      </div>
    </PageContainer>
  );
}
