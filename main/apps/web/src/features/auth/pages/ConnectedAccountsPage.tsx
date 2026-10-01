// main/apps/web/src/features/auth/pages/ConnectedAccountsPage.tsx
/**
 * ConnectedAccountsPage - Manage OAuth connected accounts.
 *
 * Features:
 * - View connected OAuth providers (Google, GitHub, Apple)
 * - Connect new OAuth providers
 * - Disconnect existing OAuth providers
 */

import { getAccessToken } from '@app/authToken';
import { useClientEnvironment } from '@app/ClientEnvironment';
import { AppleIcon, GitHubIcon, GoogleIcon } from '@auth/components/OAuthProviderIcons';
import { useEnabledOAuthProviders, useOAuthConnections } from '@bslt/react';
import { Alert, Button, Card, Dialog, Heading, PageContainer, Text } from '@bslt/ui';
import { useCallback, useMemo, useState } from 'react';

import type { OAuthConnection, OAuthProvider } from '@bslt/shared/core/auth';
import type { ReactElement } from 'react';

import { formatDate, useLocale } from '@/i18n';

const DISPLAY_OAUTH_PROVIDERS = [
  'google',
  'github',
  'apple',
] as const satisfies readonly OAuthProvider[];

type DisplayOAuthProvider = (typeof DISPLAY_OAUTH_PROVIDERS)[number];
type DisplayOAuthConnection = OAuthConnection & { provider: DisplayOAuthProvider };

// ============================================================================
// Provider Display Config
// ============================================================================

const PROVIDER_DISPLAY: Record<DisplayOAuthProvider, { label: string; icon: ReactElement }> = {
  google: { label: 'Google', icon: <GoogleIcon className="icon-md" /> },
  github: { label: 'GitHub', icon: <GitHubIcon className="icon-md" /> },
  apple: { label: 'Apple', icon: <AppleIcon className="icon-md" /> },
};

function isDisplayOAuthProvider(provider: OAuthProvider): provider is DisplayOAuthProvider {
  return provider in PROVIDER_DISPLAY;
}

function isDisplayOAuthConnection(
  connection: OAuthConnection,
): connection is DisplayOAuthConnection {
  return isDisplayOAuthProvider(connection.provider);
}

// ============================================================================
// Component
// ============================================================================

export const ConnectedAccountsPage = (): ReactElement => {
  const { config } = useClientEnvironment();
  const locale = useLocale();
  const [disconnectTarget, setDisconnectTarget] = useState<DisplayOAuthConnection | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const clientConfig = useMemo(
    () => ({
      baseUrl: config.apiUrl,
      getToken: (): string | null => {
        const token = getAccessToken();
        return typeof token === 'string' ? token : null;
      },
    }),
    [config.apiUrl],
  );

  // Get enabled providers and current connections
  const { providers: enabledProviders, isLoading: providersLoading } =
    useEnabledOAuthProviders(clientConfig);

  const {
    connections,
    isLoading: connectionsLoading,
    isActing,
    link,
    unlink,
    refresh,
  } = useOAuthConnections(clientConfig);

  const isLoading = providersLoading || connectionsLoading;

  // Build a map of connected providers
  const connectedProviderMap = useMemo(() => {
    const map = new Map<DisplayOAuthProvider, DisplayOAuthConnection>();
    for (const conn of connections.filter(isDisplayOAuthConnection)) {
      map.set(conn.provider, conn);
    }
    return map;
  }, [connections]);

  // Handlers
  const handleConnect = useCallback(
    async (provider: DisplayOAuthProvider): Promise<void> => {
      try {
        setLinkError(null);
        const url = await link(provider);
        window.location.href = url;
      } catch (err) {
        setLinkError(err instanceof Error ? err.message : 'Failed to connect account');
      }
    },
    [link],
  );

  const handleDisconnect = useCallback((connection: DisplayOAuthConnection): void => {
    setDisconnectTarget(connection);
  }, []);

  const handleConfirmDisconnect = useCallback(async (): Promise<void> => {
    if (disconnectTarget === null) return;

    try {
      const provider = disconnectTarget.provider;
      await unlink(provider);
      setDisconnectTarget(null);
    } catch {
      // Error is handled by the hook
    }
  }, [disconnectTarget, unlink]);

  // Check if user can disconnect (must have at least one other auth method)
  // For now, we allow disconnect if there's more than one connection
  // In a real app, you'd also check if user has a password set
  const canDisconnect = connections.length > 1;

  return (
    <PageContainer className="max-w-lg">
      <Heading as="h1" size="xl">
        Connected Accounts
      </Heading>
      <Text tone="muted" className="mb-4">
        Connect your social accounts for easier sign-in and account security.
      </Text>
      {linkError !== null && (
        <Alert tone="danger" className="mb-4">
          {linkError}
        </Alert>
      )}

      {isLoading ? (
        <Card>
          <Card.Body>Loading connected accounts...</Card.Body>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {DISPLAY_OAUTH_PROVIDERS.map((provider) => {
            const isEnabled = enabledProviders.includes(provider);
            const connection = connectedProviderMap.get(provider);
            const display = PROVIDER_DISPLAY[provider];

            if (!isEnabled) return null;

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
                        {connection !== undefined ? (
                          <Text tone="muted" className="text-sm">
                            {connection.providerEmail ?? 'Connected'} &middot; Since{' '}
                            {formatDate(new Date(connection.connectedAt), locale, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </Text>
                        ) : (
                          <Text tone="muted" className="text-sm">
                            Not connected
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
                            title: 'You must have at least one login method',
                          })}
                        >
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          onClick={() => {
                            void handleConnect(provider);
                          }}
                          disabled={isActing}
                        >
                          Connect
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
                <Text>No OAuth providers are currently enabled.</Text>
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
          Refresh
        </Button>
      </div>

      {/* Disconnect Confirmation Dialog */}
      <Dialog.Root
        open={disconnectTarget !== null}
        onChange={(open) => {
          if (!open) setDisconnectTarget(null);
        }}
      >
        <Dialog.Content
          title={`Disconnect ${disconnectTarget !== null ? PROVIDER_DISPLAY[disconnectTarget.provider].label : ''}?`}
        >
          <Text>
            Are you sure you want to disconnect your{' '}
            {disconnectTarget !== null ? PROVIDER_DISPLAY[disconnectTarget.provider].label : ''}{' '}
            account? You can reconnect it at any time.
          </Text>
          {!canDisconnect && (
            <Text tone="danger" className="text-sm">
              You cannot disconnect your only login method. Add a password or connect another
              account first.
            </Text>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="text"
              onClick={() => {
                setDisconnectTarget(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void handleConfirmDisconnect();
              }}
              disabled={isActing || !canDisconnect}
            >
              {isActing ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </PageContainer>
  );
};
