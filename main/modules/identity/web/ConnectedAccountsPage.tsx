// main/modules/identity/web/ConnectedAccountsPage.tsx
import { useCallback, useMemo, useState, type ReactElement } from 'react';

import { Alert, Button, Card, Dialog, Heading, PageContainer, Text } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import { AppleIcon, GitHubIcon, GoogleIcon } from './AuthPrimitives';
import { useEnabledOAuthProviders, useOAuthConnections } from './hooks';

import type { OAuthConnectionItem, OAuthProvider } from '../contract';

const TIMEZONE_STORAGE_KEY = 'abe-timezone-preference';

const DISPLAY_OAUTH_PROVIDERS = [
  'google',
  'github',
  'apple',
] as const satisfies readonly OAuthProvider[];

type DisplayOAuthProvider = (typeof DISPLAY_OAUTH_PROVIDERS)[number];
type DisplayOAuthConnection = OAuthConnectionItem & { provider: DisplayOAuthProvider };

function isDisplayOAuthProvider(provider: OAuthProvider): provider is DisplayOAuthProvider {
  return provider === 'google' || provider === 'github' || provider === 'apple';
}

function isDisplayOAuthConnection(
  connection: OAuthConnectionItem,
): connection is DisplayOAuthConnection {
  return isDisplayOAuthProvider(connection.provider);
}

function formatConnectedDate(iso: string): string {
  let timeZone: string | undefined;
  if (typeof window !== 'undefined') {
    try {
      const pref = window.localStorage.getItem(TIMEZONE_STORAGE_KEY);
      if (pref !== null && pref !== 'auto') {
        Intl.DateTimeFormat(undefined, { timeZone: pref });
        timeZone = pref;
      }
    } catch {
      timeZone = undefined;
    }
  }
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(timeZone !== undefined ? { timeZone } : {}),
  }).format(new Date(iso));
}

export const ConnectedAccountsPage = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  void t('identity.routes.connectedAccountsTitle');
  const [disconnectTarget, setDisconnectTarget] = useState<DisplayOAuthConnection | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const { providers: enabledProviders, isLoading: providersLoading } = useEnabledOAuthProviders();
  const {
    connections,
    isLoading: connectionsLoading,
    isActing,
    link,
    unlink,
    refresh,
  } = useOAuthConnections();

  const isLoading = providersLoading || connectionsLoading;

  const connectedProviderMap = useMemo(() => {
    const map = new Map<DisplayOAuthProvider, DisplayOAuthConnection>();
    for (const conn of connections.filter(isDisplayOAuthConnection)) {
      map.set(conn.provider, conn);
    }
    return map;
  }, [connections]);

  const getProviderDisplay = (
    provider: DisplayOAuthProvider,
  ): { label: string; icon: ReactElement } => {
    switch (provider) {
      case 'google':
        return {
          label: t('identity.oauth.google'),
          icon: <GoogleIcon className="icon-md" />,
        };
      case 'github':
        return {
          label: t('identity.oauth.github'),
          icon: <GitHubIcon className="icon-md" />,
        };
      case 'apple':
        return {
          label: t('identity.oauth.apple'),
          icon: <AppleIcon className="icon-md" />,
        };
    }
  };

  const handleConnect = useCallback(
    async (provider: DisplayOAuthProvider): Promise<void> => {
      try {
        setLinkError(null);
        const url = await link(provider);
        window.location.href = url;
      } catch (err) {
        setLinkError(
          err instanceof Error ? err.message : t('identity.connectedAccounts.connectFailed'),
        );
      }
    },
    [link, t],
  );

  const handleDisconnect = useCallback((connection: DisplayOAuthConnection): void => {
    setDisconnectTarget(connection);
  }, []);

  const handleConfirmDisconnect = useCallback(async (): Promise<void> => {
    if (disconnectTarget === null) return;
    try {
      setLinkError(null);
      await unlink(disconnectTarget.provider);
      setDisconnectTarget(null);
    } catch (err) {
      setLinkError(
        err instanceof Error ? err.message : t('identity.connectedAccounts.disconnectFailed'),
      );
      setDisconnectTarget(null);
    }
  }, [disconnectTarget, t, unlink]);

  const canDisconnect = connections.length > 1;
  const targetLabel =
    disconnectTarget !== null ? getProviderDisplay(disconnectTarget.provider).label : '';

  return (
    <PageContainer className="max-w-lg">
      <Heading as="h1" size="xl">
        {t('identity.connectedAccounts.heading')}
      </Heading>
      <Text tone="muted" className="mb-4">
        {t('identity.connectedAccounts.subtitle')}
      </Text>
      {linkError !== null && (
        <Alert tone="danger" className="mb-4">
          {linkError}
        </Alert>
      )}

      {isLoading ? (
        <Card>
          <Card.Body>{t('identity.connectedAccounts.loading')}</Card.Body>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {DISPLAY_OAUTH_PROVIDERS.map((provider) => {
            const isEnabled = enabledProviders.includes(provider);
            if (!isEnabled) return null;

            const connection = connectedProviderMap.get(provider);
            const display = getProviderDisplay(provider);
            const connectionSummary =
              connection !== undefined
                ? `${connection.providerEmail ?? t('identity.connectedAccounts.connectedFallback')}${t('identity.connectedAccounts.sincePrefix')}${formatConnectedDate(connection.connectedAt)}`
                : null;

            return (
              <Card key={provider}>
                <Card.Body>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="icon-md flex-center bg-surface border rounded-md">
                        {display.icon}
                      </div>
                      <div className="flex flex-col">
                        <Text as="span" className="font-medium">
                          {display.label}
                        </Text>
                        {connectionSummary !== null ? (
                          <Text tone="muted" className="text-sm">
                            {connectionSummary}
                          </Text>
                        ) : (
                          <Text tone="muted" className="text-sm">
                            {t('identity.connectedAccounts.notConnected')}
                          </Text>
                        )}
                      </div>
                    </div>
                    <div>
                      {connection !== undefined ? (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            handleDisconnect(connection);
                          }}
                          disabled={isActing || !canDisconnect}
                          {...(!canDisconnect && {
                            title: t('identity.connectedAccounts.cannotDisconnectTitle'),
                          })}
                        >
                          {t('identity.connectedAccounts.disconnectButton')}
                        </Button>
                      ) : (
                        <Button
                          onClick={() => {
                            void handleConnect(provider);
                          }}
                          disabled={isActing}
                        >
                          {t('identity.connectedAccounts.connectButton')}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card.Body>
              </Card>
            );
          })}

          {enabledProviders.length === 0 && (
            <Card>
              <Card.Body>
                <Text>{t('identity.connectedAccounts.noneEnabled')}</Text>
              </Card.Body>
            </Card>
          )}
        </div>
      )}

      <div className="flex justify-end mt-3">
        <Button
          variant="text"
          onClick={() => {
            void refresh();
          }}
          disabled={isLoading || isActing}
        >
          {t('identity.connectedAccounts.refresh')}
        </Button>
      </div>

      <Dialog.Root
        open={disconnectTarget !== null}
        onChange={(open) => {
          if (!open) setDisconnectTarget(null);
        }}
      >
        <Dialog.Content
          title={t('identity.connectedAccounts.dialogTitle').replace('{provider}', targetLabel)}
        >
          <Text>
            {t('identity.connectedAccounts.dialogBody').replace('{provider}', targetLabel)}
          </Text>
          {!canDisconnect && (
            <Text tone="danger" className="text-sm">
              {t('identity.connectedAccounts.onlyMethodWarning')}
            </Text>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="text"
              onClick={() => {
                setDisconnectTarget(null);
              }}
            >
              {t('identity.connectedAccounts.cancel')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void handleConfirmDisconnect();
              }}
              disabled={isActing || !canDisconnect}
            >
              {isActing
                ? t('identity.connectedAccounts.disconnecting')
                : t('identity.connectedAccounts.disconnectButton')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </PageContainer>
  );
};
