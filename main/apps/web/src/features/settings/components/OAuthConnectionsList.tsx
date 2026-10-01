// main/apps/web/src/features/settings/components/OAuthConnectionsList.tsx
/**
 * OAuth Connections List Component
 *
 * Displays linked OAuth providers and allows connecting/disconnecting.
 */

import { getAccessToken } from '@app/authToken';
import { useEnabledOAuthProviders, useOAuthConnections } from '@bslt/react';
import { Alert, Button, Card, Modal, Skeleton, Text } from '@bslt/ui';
import { CardAsyncState } from '@bslt/ui/components';
import { clientConfig as appClientConfig } from '@config';
import { useMemo, useState, type ReactElement } from 'react';

import type { ApiClientConfig } from '@bslt/api';
import type { OAuthConnection, OAuthProvider } from '@bslt/shared/core/auth';

// ============================================================================
// Types
// ============================================================================

export interface OAuthConnectionsListProps {
  onSuccess?: () => void;
}

// ============================================================================
// Provider Icons and Names
// ============================================================================

const providerInfo = {
  google: { name: 'Google', icon: 'G' },
  github: { name: 'GitHub', icon: 'GH' },
  apple: { name: 'Apple', icon: '' },
} as const satisfies Record<'google' | 'github' | 'apple', { name: string; icon: string }>;

type DisplayOAuthProvider = keyof typeof providerInfo;
type DisplayOAuthConnection = OAuthConnection & { provider: DisplayOAuthProvider };

function isDisplayOAuthProvider(provider: OAuthProvider): provider is DisplayOAuthProvider {
  return provider in providerInfo;
}

function isDisplayOAuthConnection(
  connection: OAuthConnection,
): connection is DisplayOAuthConnection {
  return isDisplayOAuthProvider(connection.provider);
}

// ============================================================================
// Component
// ============================================================================

export const OAuthConnectionsList = ({ onSuccess }: OAuthConnectionsListProps): ReactElement => {
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<DisplayOAuthProvider | null>(null);

  // API client config
  const apiConfig = useMemo<ApiClientConfig>(
    () => ({
      baseUrl: appClientConfig.apiUrl,
      getToken: getAccessToken,
    }),
    [],
  );

  // Hooks
  const {
    providers: enabledProviders,
    isLoading: isLoadingProviders,
    error: providersError,
  } = useEnabledOAuthProviders(apiConfig);

  const {
    connections,
    isLoading: isLoadingConnections,
    isActing,
    error: connectionsError,
    unlink,
    link,
  } = useOAuthConnections(apiConfig);

  const handleConnect = async (provider: DisplayOAuthProvider): Promise<void> => {
    try {
      setLinkError(null);
      const url = await link(provider);
      window.location.assign(url);
    } catch (err) {
      const info = providerInfo[provider];
      setLinkError(err instanceof Error ? err.message : `Failed to connect ${info.name}`);
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
      setUnlinkError(err instanceof Error ? err.message : `Failed to disconnect ${info.name}`);
    }
  };

  // Loading state
  if (isLoadingProviders || isLoadingConnections) {
    return (
      <CardAsyncState
        isLoading={true}
        cardClassName="p-4"
        loadingContent={
          <div className="space-y-3">
            <Skeleton height="4rem" className="w-full" />
            <Skeleton height="4rem" className="w-full" />
            <Skeleton height="4rem" className="w-full" />
          </div>
        }
      />
    );
  }

  // Error state
  if (providersError !== null || connectionsError !== null) {
    const errorMessage =
      providersError?.message ?? connectionsError?.message ?? 'Unknown OAuth error';
    return (
      <CardAsyncState
        errorMessage={errorMessage}
        cardClassName="p-4"
        errorContent={<Alert tone="danger">Failed to load OAuth connections: {errorMessage}</Alert>}
      />
    );
  }

  // No providers enabled
  if (enabledProviders.length === 0) {
    return (
      <Text size="sm" tone="muted">
        No OAuth providers are configured for this application.
      </Text>
    );
  }

  // Build provider list with connection status
  const providerList = enabledProviders.filter(isDisplayOAuthProvider).map((provider) => {
    const connection = connections
      .filter(isDisplayOAuthConnection)
      .find((candidate) => candidate.provider === provider);
    return {
      provider,
      connected: connection !== undefined,
      connection,
    };
  });

  return (
    <div className="space-y-3">
      {unlinkError !== null && unlinkError.length > 0 && <Alert tone="danger">{unlinkError}</Alert>}
      {linkError !== null && linkError.length > 0 && <Alert tone="danger">{linkError}</Alert>}

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

      {connections.length === 0 && (
        <Text size="sm" tone="muted" className="text-center py-2">
          Connect an account for easier sign-in.
        </Text>
      )}

      <Modal.Root
        open={pendingDisconnect !== null}
        onClose={() => {
          setPendingDisconnect(null);
        }}
      >
        <Modal.Header>
          <Modal.Title>Disconnect account</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Modal.Description>
            {pendingDisconnect !== null
              ? `${providerInfo[pendingDisconnect].name} will no longer be available for sign-in.`
              : ''}
          </Modal.Description>
        </Modal.Body>
        <Modal.Footer>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setPendingDisconnect(null);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              void confirmDisconnect();
            }}
          >
            Disconnect
          </Button>
        </Modal.Footer>
      </Modal.Root>
    </div>
  );
};

// ============================================================================
// Provider Card Sub-component
// ============================================================================

interface ProviderCardProps {
  provider: DisplayOAuthProvider;
  connected: boolean;
  connection: DisplayOAuthConnection | null;
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
  const info = providerInfo[provider];

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="settings-provider-icon">{info.icon}</div>
          <div>
            <Text className="font-medium">{info.name}</Text>
            {connected && connection !== null && (
              <Text size="sm" tone="muted">
                {connection.providerEmail}
              </Text>
            )}
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
            {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        ) : (
          <Button variant="secondary" size="small" onClick={onConnect} disabled={isConnecting}>
            {isConnecting ? 'Connecting...' : 'Connect'}
          </Button>
        )}
      </div>
    </Card>
  );
};
