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

type OnboardingStep = 1 | 2 | 3;

const STEPS: readonly {
  readonly id: OnboardingStep;
  readonly title: string;
  readonly subtitle: string;
}[] = [
  { id: 1, title: 'Your profile', subtitle: 'Set how teammates recognize you' },
  { id: 2, title: 'Workspace identity', subtitle: 'Name your shared workspace' },
  { id: 3, title: 'Team & plan', subtitle: 'Invite teammates or launch' },
];

export function OnboardingPage(): ReactElement {
  const navigate = useNavigate();
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
      setStatusMessage('Profile details saved.');
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
      setStatusMessage('Workspace name updated.');
      setErrorMessage(null);
      setStep(3);
    },
  });

  const inviteMutation = useOptionalCreateInvitation({
    onSuccess: () => {
      setInvitedCount((count) => count + 1);
      setInviteEmail('');
      setStatusMessage('Invitation sent.');
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
      setErrorMessage('Please enter your first name to continue, or skip this step.');
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
      setErrorMessage('Workspace name must be at least 2 characters.');
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
      setErrorMessage('Enter a valid teammate email address.');
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
          <Badge tone="info">Workspace Setup</Badge>
          <Heading as="h1" size="xl">
            Set up {BRAND.name}
          </Heading>
          <Text tone="muted" size="sm">
            Finish these quick steps to personalize your profile, workspace, and team access.
          </Text>
        </div>
        <Button type="button" variant="text" onClick={handleFinish}>
          Skip for now
        </Button>
      </header>

      <nav className="onboarding-stepper" aria-label="Onboarding steps">
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
                  {item.title}
                </Text>
                <Text size="xs" tone="muted">
                  {item.subtitle}
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
              1. Confirm your profile
            </Heading>
            <Text tone="muted" size="sm">
              Your name appears across workspace activity, comments, and team invitations.
            </Text>
          </div>

          {hasFilesModule ? <OptionalAvatarUpload userName={displayName} /> : null}

          <form className="onboarding-form" onSubmit={handleProfileSubmit}>
            <div className="onboarding-form__row">
              <div className="onboarding-field">
                <label htmlFor="onboarding-first-name" className="onboarding-field__label">
                  First name
                </label>
                <Input
                  id="onboarding-first-name"
                  value={firstName}
                  onChange={(event) => {
                    setFirstName(event.target.value);
                  }}
                  placeholder="Alex"
                  autoComplete="given-name"
                />
              </div>
              <div className="onboarding-field">
                <label htmlFor="onboarding-last-name" className="onboarding-field__label">
                  Last name
                </label>
                <Input
                  id="onboarding-last-name"
                  value={lastName}
                  onChange={(event) => {
                    setLastName(event.target.value);
                  }}
                  placeholder="Rivera"
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
                Skip step
              </Button>
              <Button type="submit" disabled={profileUpdate.isLoading}>
                {profileUpdate.isLoading ? 'Saving…' : 'Save & continue'}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card className="onboarding-card">
          <div>
            <Heading as="h2" size="md">
              2. Name your workspace
            </Heading>
            <Text tone="muted" size="sm">
              {teamsEnabled && activeOrg !== null
                ? 'Choose a recognizable name for your shared team workspace.'
                : 'Your account is currently configured for solo use. You can enable team workspaces anytime.'}
            </Text>
          </div>

          <form className="onboarding-form" onSubmit={handleWorkspaceSubmit}>
            {teamsEnabled && activeOrg !== null ? (
              <div className="onboarding-field">
                <label htmlFor="onboarding-workspace-name" className="onboarding-field__label">
                  Workspace name
                </label>
                <Input
                  id="onboarding-workspace-name"
                  value={workspaceName}
                  onChange={(event) => {
                    setWorkspaceName(event.target.value);
                  }}
                  placeholder="Acme Studio"
                />
                <Text size="xs" tone="muted">
                  Current slug: /{activeOrg.slug}
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
                Back
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
                  Skip step
                </Button>
                <Button type="submit" disabled={orgUpdate.isLoading}>
                  {orgUpdate.isLoading ? 'Updating…' : 'Continue'}
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
              3. Invite teammates &amp; explore plans
            </Heading>
            <Text tone="muted" size="sm">
              Bring collaborators into your workspace now or finish setup and head to your
              dashboard.
            </Text>
          </div>

          {teamsEnabled && activeOrg !== null ? (
            <form className="onboarding-form" onSubmit={handleInviteSubmit}>
              <div className="onboarding-field">
                <label htmlFor="onboarding-invite-email" className="onboarding-field__label">
                  Teammate email
                </label>
                <Input
                  id="onboarding-invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                  }}
                  placeholder="teammate@company.com"
                />
              </div>
              <div className="onboarding-actions__group">
                <Button type="submit" variant="secondary" disabled={inviteMutation.isLoading}>
                  {inviteMutation.isLoading ? 'Sending…' : 'Send invitation'}
                </Button>
                {invitedCount > 0 ? (
                  <Badge tone="success">
                    {String(invitedCount)} invitation{invitedCount === 1 ? '' : 's'} sent
                  </Badge>
                ) : null}
              </div>
            </form>
          ) : null}

          {billingEnabled ? (
            <div className="onboarding-plan-callout">
              <div>
                <Text size="sm" className="onboarding-field__label">
                  Ready for higher limits and team features?
                </Text>
                <Text size="xs" tone="muted">
                  Compare starter and team plans with instant entitlement activation.
                </Text>
              </div>
              <Link to="/pricing">
                <Button variant="secondary" size="small">
                  Explore plans
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
              Back
            </Button>
            <Button type="button" onClick={handleFinish}>
              Finish setup &amp; open Dashboard
            </Button>
          </div>
        </Card>
      ) : null}
    </PageContainer>
  );
}
