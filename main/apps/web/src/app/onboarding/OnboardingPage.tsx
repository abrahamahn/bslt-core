// main/apps/web/src/app/onboarding/OnboardingPage.tsx
import { useAuth, useProfileUpdate } from '@bslt/identity/web';
import { Link, useNavigate } from '@bslt/react/router';
import { Alert, Badge, Button, Card, Heading, Input, PageContainer, Text } from '@bslt/ui';
import { useCapabilities } from '@bslt/web-platform';
import { useEffect, useMemo, useState, type ReactElement, type SyntheticEvent } from 'react';

import { BRAND } from '../../generated/brand';
import {
  hasBillingModule,
  hasFilesModule,
  hasOrgsModule,
  OptionalAvatarUpload,
  useOptionalActiveOrg,
  useOptionalCreateInvitation,
  useOptionalOrganizations,
  useOptionalUpdateOrganization,
} from '../../generated/modules';

import { setOnboardingCompleted } from './onboardingState';

import './OnboardingPage.css';

import { useChromeTranslation } from '#app/i18n/chromeLabels';

type OnboardingStep = 1 | 2 | 3;

const STEPS: readonly {
  readonly id: OnboardingStep;
  readonly titleKey: string;
  readonly subtitleKey: string;
}[] = [
  { id: 1, titleKey: 'onboarding.stepOne.title', subtitleKey: 'onboarding.stepOne.subtitle' },
  { id: 2, titleKey: 'onboarding.stepTwo.title', subtitleKey: 'onboarding.stepTwo.subtitle' },
  { id: 3, titleKey: 'onboarding.stepThree.title', subtitleKey: 'onboarding.stepThree.subtitle' },
];

export function OnboardingPage(): ReactElement {
  const navigate = useNavigate();
  const { t } = useChromeTranslation();
  const { user } = useAuth();
  const { isFlagEnabled } = useCapabilities();
  const teamsEnabled = hasOrgsModule && isFlagEnabled('orgs.teams');
  const billingEnabled = hasBillingModule && isFlagEnabled('flags.billing');

  const [step, setStep] = useState<OnboardingStep>(1);
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { activeOrgId } = useOptionalActiveOrg();
  const { organizations, refresh: refreshOrgs } = useOptionalOrganizations({
    enabled: teamsEnabled && user !== null,
  });

  const activeOrg = useMemo(() => {
    if (organizations.length === 0) return null;
    if (activeOrgId !== null) {
      return organizations.find((org) => org.id === activeOrgId) ?? organizations[0] ?? null;
    }
    return organizations[0] ?? null;
  }, [activeOrgId, organizations]);

  const [workspaceName, setWorkspaceName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitedCount, setInvitedCount] = useState(0);

  useEffect(() => {
    if (user?.firstName !== undefined && firstName === '') {
      setFirstName(user.firstName);
    }
    if (user?.lastName !== undefined && lastName === '') {
      setLastName(user.lastName);
    }
  }, [firstName, lastName, user?.firstName, user?.lastName]);

  useEffect(() => {
    if (activeOrg !== null && workspaceName === '') {
      setWorkspaceName(activeOrg.name);
    }
  }, [activeOrg, workspaceName]);

  const profileUpdate = useProfileUpdate({
    onSuccess: () => {
      setStatusMessage(t('onboarding.stepOne.saved'));
      setErrorMessage(null);
      setStep(2);
    },
    onError: (err) => {
      setErrorMessage(err.message);
      setStatusMessage(null);
    },
  });

  const orgUpdate = useOptionalUpdateOrganization({
    onSuccess: () => {
      void refreshOrgs();
      setStatusMessage(t('onboarding.stepTwo.updated'));
      setErrorMessage(null);
      setStep(3);
    },
  });

  const inviteMutation = useOptionalCreateInvitation({
    onSuccess: () => {
      setInvitedCount((count) => count + 1);
      setInviteEmail('');
      setStatusMessage(t('onboarding.stepThree.inviteSent'));
      setErrorMessage(null);
    },
  });

  const handleFinish = (): void => {
    setOnboardingCompleted(user?.id, true);
    navigate('/dashboard');
  };

  const handleProfileSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    if (trimmedFirst.length === 0) {
      setErrorMessage(t('onboarding.stepOne.firstNameRequired'));
      return;
    }
    setErrorMessage(null);
    profileUpdate.updateProfile({
      firstName: trimmedFirst,
      ...(trimmedLast.length > 0 ? { lastName: trimmedLast } : {}),
    });
  };

  const handleWorkspaceSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!teamsEnabled || activeOrg === null) {
      setStep(3);
      return;
    }
    const trimmedName = workspaceName.trim();
    if (trimmedName.length < 2) {
      setErrorMessage(t('onboarding.stepTwo.nameTooShort'));
      return;
    }
    if (trimmedName === activeOrg.name) {
      setStep(3);
      return;
    }
    setErrorMessage(null);
    orgUpdate.mutate({ id: activeOrg.id, data: { name: trimmedName } });
  };

  const handleInviteSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!teamsEnabled || activeOrg === null) return;
    const trimmedEmail = inviteEmail.trim();
    if (trimmedEmail.length === 0 || !trimmedEmail.includes('@')) {
      setErrorMessage(t('onboarding.stepThree.invalidEmail'));
      return;
    }
    setErrorMessage(null);
    inviteMutation.mutate({
      tenantId: activeOrg.id,
      data: { email: trimmedEmail, role: 'member' },
    });
  };

  const displayName = `${firstName} ${lastName}`.trim() || user?.email || BRAND.name;

  return (
    <PageContainer className="onboarding-page" maxWidth={820}>
      <header className="onboarding-header">
        <div className="onboarding-header__copy">
          <Badge tone="info">{t('onboarding.badge')}</Badge>
          <Heading as="h1" size="xl">
            {t('onboarding.heading', { brand: BRAND.name })}
          </Heading>
          <Text tone="muted" size="sm">
            {t('onboarding.subtitle')}
          </Text>
        </div>
        <Button type="button" variant="text" onClick={handleFinish}>
          {t('onboarding.skipForNow')}
        </Button>
      </header>

      <nav className="onboarding-stepper" aria-label={t('onboarding.stepsAria')}>
        {STEPS.map((item) => {
          const isActive = item.id === step;
          const isCompleted = item.id < step;
          return (
            <Button
              key={item.id}
              type="button"
              variant="text"
              className="onboarding-step-pill"
              data-active={isActive ? 'true' : 'false'}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => {
                setErrorMessage(null);
                setStatusMessage(null);
                setStep(item.id);
              }}
            >
              <Badge tone={isCompleted ? 'success' : isActive ? 'info' : 'neutral'}>
                {String(item.id)}
              </Badge>
              <div>
                <Text size="sm" className="onboarding-field__label">
                  {t(item.titleKey)}
                </Text>
                <Text size="xs" tone="muted">
                  {t(item.subtitleKey)}
                </Text>
              </div>
            </Button>
          );
        })}
      </nav>

      {errorMessage !== null ? <Alert tone="danger">{errorMessage}</Alert> : null}
      {orgUpdate.error !== null ? <Alert tone="danger">{orgUpdate.error.message}</Alert> : null}
      {inviteMutation.error !== null ? (
        <Alert tone="danger">{inviteMutation.error.message}</Alert>
      ) : null}
      {statusMessage !== null ? <Alert tone="success">{statusMessage}</Alert> : null}

      {step === 1 ? (
        <Card className="onboarding-card">
          <div>
            <Heading as="h2" size="md">
              {t('onboarding.stepOne.heading')}
            </Heading>
            <Text tone="muted" size="sm">
              {t('onboarding.stepOne.description')}
            </Text>
          </div>

          {hasFilesModule ? <OptionalAvatarUpload userName={displayName} /> : null}

          <form className="onboarding-form" onSubmit={handleProfileSubmit}>
            <div className="onboarding-form__row">
              <div className="onboarding-field">
                <label htmlFor="onboarding-first-name" className="onboarding-field__label">
                  {t('onboarding.stepOne.firstName')}
                </label>
                <Input
                  id="onboarding-first-name"
                  value={firstName}
                  onChange={(event) => {
                    setFirstName(event.target.value);
                  }}
                  placeholder={t('onboarding.stepOne.firstNamePlaceholder')}
                  autoComplete="given-name"
                />
              </div>
              <div className="onboarding-field">
                <label htmlFor="onboarding-last-name" className="onboarding-field__label">
                  {t('onboarding.stepOne.lastName')}
                </label>
                <Input
                  id="onboarding-last-name"
                  value={lastName}
                  onChange={(event) => {
                    setLastName(event.target.value);
                  }}
                  placeholder={t('onboarding.stepOne.lastNamePlaceholder')}
                  autoComplete="family-name"
                />
              </div>
            </div>

            <div className="onboarding-actions">
              <Button
                type="button"
                variant="text"
                onClick={() => {
                  setErrorMessage(null);
                  setStep(2);
                }}
              >
                {t('onboarding.skipStep')}
              </Button>
              <Button type="submit" disabled={profileUpdate.isLoading}>
                {profileUpdate.isLoading
                  ? t('onboarding.stepOne.saving')
                  : t('onboarding.stepOne.submit')}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card className="onboarding-card">
          <div>
            <Heading as="h2" size="md">
              {t('onboarding.stepTwo.heading')}
            </Heading>
            <Text tone="muted" size="sm">
              {teamsEnabled && activeOrg !== null
                ? t('onboarding.stepTwo.teamDescription')
                : t('onboarding.stepTwo.soloDescription')}
            </Text>
          </div>

          <form className="onboarding-form" onSubmit={handleWorkspaceSubmit}>
            {teamsEnabled && activeOrg !== null ? (
              <div className="onboarding-field">
                <label htmlFor="onboarding-workspace-name" className="onboarding-field__label">
                  {t('onboarding.stepTwo.workspaceName')}
                </label>
                <Input
                  id="onboarding-workspace-name"
                  value={workspaceName}
                  onChange={(event) => {
                    setWorkspaceName(event.target.value);
                  }}
                  placeholder={t('onboarding.stepTwo.workspacePlaceholder')}
                />
                <Text size="xs" tone="muted">
                  {t('onboarding.stepTwo.currentSlug', { slug: activeOrg.slug })}
                </Text>
              </div>
            ) : null}

            <div className="onboarding-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setErrorMessage(null);
                  setStep(1);
                }}
              >
                {t('common.back')}
              </Button>
              <div className="onboarding-actions__group">
                <Button
                  type="button"
                  variant="text"
                  onClick={() => {
                    setErrorMessage(null);
                    setStep(3);
                  }}
                >
                  {t('onboarding.skipStep')}
                </Button>
                <Button type="submit" disabled={orgUpdate.isLoading}>
                  {orgUpdate.isLoading
                    ? t('onboarding.stepTwo.updating')
                    : t('onboarding.stepTwo.submit')}
                </Button>
              </div>
            </div>
          </form>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card className="onboarding-card">
          <div>
            <Heading as="h2" size="md">
              {t('onboarding.stepThree.heading')}
            </Heading>
            <Text tone="muted" size="sm">
              {t('onboarding.stepThree.description')}
            </Text>
          </div>

          {teamsEnabled && activeOrg !== null ? (
            <form className="onboarding-form" onSubmit={handleInviteSubmit}>
              <div className="onboarding-field">
                <label htmlFor="onboarding-invite-email" className="onboarding-field__label">
                  {t('onboarding.stepThree.inviteEmail')}
                </label>
                <Input
                  id="onboarding-invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                  }}
                  placeholder={t('onboarding.stepThree.invitePlaceholder')}
                />
              </div>
              <div className="onboarding-actions__group">
                <Button type="submit" variant="secondary" disabled={inviteMutation.isLoading}>
                  {inviteMutation.isLoading
                    ? t('onboarding.stepThree.sending')
                    : t('onboarding.stepThree.sendInvite')}
                </Button>
                {invitedCount > 0 ? (
                  <Badge tone="success">
                    {invitedCount === 1
                      ? t('onboarding.stepThree.sentOne', { count: 1 })
                      : t('onboarding.stepThree.sentMany', { count: invitedCount })}
                  </Badge>
                ) : null}
              </div>
            </form>
          ) : null}

          {billingEnabled ? (
            <div className="onboarding-plan-callout">
              <div>
                <Text size="sm" className="onboarding-field__label">
                  {t('onboarding.stepThree.planHeading')}
                </Text>
                <Text size="xs" tone="muted">
                  {t('onboarding.stepThree.planDescription')}
                </Text>
              </div>
              <Link to="/pricing">
                <Button variant="secondary" size="small">
                  {t('onboarding.stepThree.explorePlans')}
                </Button>
              </Link>
            </div>
          ) : null}

          <div className="onboarding-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setErrorMessage(null);
                setStep(2);
              }}
            >
              {t('common.back')}
            </Button>
            <Button type="button" onClick={handleFinish}>
              {t('onboarding.stepThree.finish')}
            </Button>
          </div>
        </Card>
      ) : null}
    </PageContainer>
  );
}
