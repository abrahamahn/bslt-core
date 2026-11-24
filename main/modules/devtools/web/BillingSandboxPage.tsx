// main/modules/devtools/web/BillingSandboxPage.tsx
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { useTransport } from '@bslt/react';
import { Link } from '@bslt/react/router';
import { Alert, Badge, Button, Card, Heading, PageContainer, Text } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import './DevtoolsPages.css';

interface SandboxPlan {
  readonly id: string;
  readonly name: string;
  readonly priceInCents: number;
  readonly currency: string;
  readonly interval: string;
}

interface SandboxSubscription {
  readonly id: string;
  readonly status: string;
  readonly planId: string;
  readonly plan?: { readonly name?: string };
  readonly cancelAtPeriodEnd?: boolean;
}

const STARTER_PLANS = [
  {
    name: 'Free',
    description: 'Core workspace features for solo builders.',
    interval: 'month',
    priceInCents: 0,
    currency: 'usd',
    trialDays: 0,
    sortOrder: 0,
    features: [
      { key: 'projects', name: 'Projects', included: true, value: 3 },
      { key: 'storage', name: 'Storage (GB)', included: true, value: 1 },
    ],
  },
  {
    name: 'Pro',
    description: 'Higher quotas, API access, and team collaboration.',
    interval: 'month',
    priceInCents: 2900,
    currency: 'usd',
    trialDays: 14,
    sortOrder: 1,
    features: [
      { key: 'projects', name: 'Projects', included: true, value: 25 },
      { key: 'storage', name: 'Storage (GB)', included: true, value: 100 },
      { key: 'api_access', name: 'API access', included: true, value: true },
    ],
  },
  {
    name: 'Team',
    description: 'Expanded seats, webhooks, and custom branding.',
    interval: 'month',
    priceInCents: 9900,
    currency: 'usd',
    trialDays: 14,
    sortOrder: 2,
    features: [
      { key: 'projects', name: 'Projects', included: true, value: 250 },
      { key: 'storage', name: 'Storage (GB)', included: true, value: 1000 },
      { key: 'api_access', name: 'API access', included: true, value: true },
      { key: 'custom_branding', name: 'Custom branding', included: true, value: true },
    ],
  },
] as const;

export function BillingSandboxPage(): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const transport = useTransport();
  const [plans, setPlans] = useState<readonly SandboxPlan[]>([]);
  const [subscription, setSubscription] = useState<SandboxSubscription | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastCheckoutUrl, setLastCheckoutUrl] = useState<string | null>(null);

  const loadState = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const plansRes = await transport.request<{ plans?: readonly SandboxPlan[] }>(
        '/api/billing/plans',
        { method: 'GET' },
      );
      setPlans(plansRes.plans ?? []);
      const subRes = await transport.request<{ subscription?: SandboxSubscription | null }>(
        '/api/billing/subscription',
        { method: 'GET' },
      );
      setSubscription(subRes.subscription ?? null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load billing sandbox state.');
    } finally {
      setLoading(false);
    }
  }, [transport]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const handleSeedStarterPlans = async (): Promise<void> => {
    setActing(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const existingNames = new Set(plans.map((p) => p.name.toLowerCase()));
      let created = 0;
      for (const plan of STARTER_PLANS) {
        if (existingNames.has(plan.name.toLowerCase())) continue;
        await transport.request('/api/admin/billing/plans/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(plan),
        });
        created += 1;
      }
      setStatusMessage(
        created > 0
          ? `Created ${String(created)} starter billing plan(s).`
          : 'Starter plans already exist.',
      );
      await loadState();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Sign in as a platform admin to seed billing plans.',
      );
    } finally {
      setActing(false);
    }
  };

  const handleStartCheckout = async (plan: SandboxPlan): Promise<void> => {
    setActing(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await transport.request<{ url?: string; sessionId?: string }>(
        '/api/billing/checkout',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId: plan.id }),
        },
      );
      setLastCheckoutUrl(res.url ?? null);
      setStatusMessage(`Created mock checkout session for ${plan.name}.`);
      await loadState();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Checkout simulation failed.');
    } finally {
      setActing(false);
    }
  };

  const handleToggleCancel = async (): Promise<void> => {
    if (subscription === null) return;
    setActing(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const endpoint =
        subscription.cancelAtPeriodEnd === true
          ? '/api/billing/subscription/resume'
          : '/api/billing/subscription/cancel';
      await transport.request(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.cancelAtPeriodEnd === true ? {} : { immediately: false }),
      });
      setStatusMessage(
        subscription.cancelAtPeriodEnd === true
          ? 'Resumed workspace subscription.'
          : 'Scheduled subscription cancellation at period end.',
      );
      await loadState();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Subscription action failed.');
    } finally {
      setActing(false);
    }
  };

  return (
    <PageContainer className="dev-inbox-page" maxWidth={1120}>
      <header className="dev-inbox-header">
        <div className="dev-inbox-header__copy">
          <Badge tone="info">{t('devtools.sandbox.badge')}</Badge>
          <Heading as="h1" size="xl">
            {t('devtools.billingSandbox.heading')}
          </Heading>
          <Text tone="muted" size="sm">
            {t('devtools.billingSandbox.subtitle')}
          </Text>
        </div>
        <div className="dev-inbox-header__actions">
          <Link to="/developer/emails">
            <Button variant="secondary" size="small">
              {t('devtools.billingSandbox.emailInboxLink')}
            </Button>
          </Link>
          <Button
            type="button"
            variant="secondary"
            size="small"
            disabled={loading}
            onClick={() => {
              void loadState();
            }}
          >
            {loading ? t('devtools.emailInbox.refreshing') : t('devtools.emailInbox.refresh')}
          </Button>
          <Button
            type="button"
            size="small"
            disabled={acting}
            onClick={() => {
              void handleSeedStarterPlans();
            }}
          >
            {t('devtools.billingSandbox.seedPlans')}
          </Button>
        </div>
      </header>

      {errorMessage !== null ? <Alert tone="danger">{errorMessage}</Alert> : null}
      {statusMessage !== null ? <Alert tone="success">{statusMessage}</Alert> : null}

      <div className="dev-sandbox-grid">
        <Card className="dev-inbox-preview">
          <Heading as="h2" size="md">
            {t('devtools.billingSandbox.activeSubHeading')}
          </Heading>
          {subscription === null ? (
            <Text size="sm" tone="muted">
              {t('devtools.billingSandbox.noSubDescription')}
            </Text>
          ) : (
            <div className="dev-sandbox-sub">
              <div className="dev-inbox-list__item-top">
                <Text size="sm" className="dev-inbox-list__subject">
                  {subscription.plan?.name ?? subscription.planId}
                </Text>
                <Badge tone={subscription.status === 'active' ? 'success' : 'info'}>
                  {subscription.status}
                </Badge>
              </div>
              <Text size="xs" tone="muted">
                {t('devtools.billingSandbox.subscriptionId', { id: subscription.id })}
              </Text>
              <div className="dev-inbox-header__actions">
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  disabled={acting}
                  onClick={() => {
                    void handleToggleCancel();
                  }}
                >
                  {subscription.cancelAtPeriodEnd === true
                    ? t('devtools.billingSandbox.resumeSub')
                    : t('devtools.billingSandbox.cancelSub')}
                </Button>
                <Link to="/workspace/billing">
                  <Button variant="text" size="small">
                    {t('devtools.billingSandbox.openWorkspaceBilling')}
                  </Button>
                </Link>
              </div>
            </div>
          )}
          {lastCheckoutUrl !== null ? (
            <div className="dev-inbox-links">
              <Text size="xs" tone="muted" className="dev-inbox-list__subject">
                {t('devtools.billingSandbox.lastCheckoutUrl')}
              </Text>
              <Text size="xs">{lastCheckoutUrl}</Text>
            </div>
          ) : null}
        </Card>

        <Card className="dev-inbox-preview">
          <Heading as="h2" size="md">
            {t('devtools.billingSandbox.configuredPlans', { count: String(plans.length) })}
          </Heading>
          {plans.length === 0 ? (
            <Text size="sm" tone="muted">
              {t('devtools.billingSandbox.noPlansDescription')}
            </Text>
          ) : (
            <div className="dev-sandbox-plan-list">
              {plans.map((plan) => (
                <div key={plan.id} className="dev-sandbox-plan-row">
                  <div>
                    <Text size="sm" className="dev-inbox-list__subject">
                      {plan.name}
                    </Text>
                    <Text size="xs" tone="muted">
                      {t('devtools.billingSandbox.planPrice', {
                        price: (plan.priceInCents / 100).toFixed(2),
                        interval: plan.interval,
                      })}
                    </Text>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    disabled={acting}
                    onClick={() => {
                      void handleStartCheckout(plan);
                    }}
                  >
                    {t('devtools.billingSandbox.simulateCheckout')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
