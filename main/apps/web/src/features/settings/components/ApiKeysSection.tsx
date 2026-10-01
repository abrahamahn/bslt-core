// main/apps/web/src/features/settings/components/ApiKeysSection.tsx
/**
 * API Keys Section
 *
 * Lets a user create, view, and revoke personal API keys. The plaintext token
 * is shown exactly once, immediately after creation; thereafter only a masked
 * `prefix…last4` label is available.
 */

import { formatDate } from '@bslt/shared/helpers/date';
import { Alert, Button, FormField, Input, Select, Text } from '@bslt/ui';
import { useState, type ReactElement } from 'react';

import { useApiKeys, useCreateApiKey, useDeleteApiKey } from '../hooks/useApiKeys';

import type { ApiKey, CreatedApiKey } from '@bslt/shared/core/api-keys';

const EXPIRY_OPTIONS: readonly { value: string; label: string; days: number | null }[] = [
  { value: 'never', label: 'Never expires', days: null },
  { value: '30', label: '30 days', days: 30 },
  { value: '90', label: '90 days', days: 90 },
  { value: '365', label: '1 year', days: 365 },
];

function maskedLabel(key: ApiKey): string {
  return `${key.keyPrefix}…${key.last4}`;
}

const CreatedKeyAlert = ({
  createdKey,
  onDismiss,
}: {
  createdKey: CreatedApiKey;
  onDismiss: () => void;
}): ReactElement => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(createdKey.token).then(
      () => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 2000);
      },
      () => undefined,
    );
  };

  return (
    <Alert tone="success">
      <div className="flex flex-col gap-2">
        <Text size="sm">Copy your new key now — for security it will not be shown again.</Text>
        <code className="bg-surface border rounded p-2 break-all">{createdKey.token}</code>
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="text" size="small" onClick={handleCopy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button type="button" variant="secondary" size="small" onClick={onDismiss}>
            Done
          </Button>
        </div>
      </div>
    </Alert>
  );
};

const ApiKeyRow = ({
  apiKey,
  onRevoke,
  isRevoking,
}: {
  apiKey: ApiKey;
  onRevoke: (id: string) => void;
  isRevoking: boolean;
}): ReactElement => {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex items-center justify-between gap-3 border-t p-3">
      <div className="flex flex-col gap-1">
        <Text size="sm">{apiKey.name}</Text>
        <Text size="xs" tone="muted">
          <code>{maskedLabel(apiKey)}</code> · Created {formatDate(apiKey.createdAt)}
          {apiKey.lastUsedAt !== null
            ? ` · Last used ${formatDate(apiKey.lastUsedAt)}`
            : ' · Never used'}
          {apiKey.expiresAt !== null ? ` · Expires ${formatDate(apiKey.expiresAt)}` : ''}
        </Text>
      </div>
      {confirming ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="danger"
            size="small"
            disabled={isRevoking}
            onClick={() => {
              onRevoke(apiKey.id);
            }}
          >
            {isRevoking ? 'Revoking…' : 'Confirm'}
          </Button>
          <Button
            type="button"
            variant="text"
            size="small"
            onClick={() => {
              setConfirming(false);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="text"
          size="small"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Revoke
        </Button>
      )}
    </div>
  );
};

export const ApiKeysSection = (): ReactElement => {
  const { data: keys, isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const deleteKey = useDeleteApiKey();

  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<string>('never');
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setFormError('Name is required');
      return;
    }
    const days = EXPIRY_OPTIONS.find((option) => option.value === expiry)?.days ?? null;
    void createKey.mutateAsync({ name: trimmed, expiresInDays: days }).then(
      (response) => {
        setCreatedKey(response.key);
        setName('');
        setExpiry('never');
      },
      () => undefined,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Text size="sm" tone="muted">
        API keys authenticate programmatic requests as your account. Send them as a
        <code> Authorization: Bearer </code> header. Treat a key like a password.
      </Text>

      {createdKey !== null ? (
        <CreatedKeyAlert
          createdKey={createdKey}
          onDismiss={() => {
            setCreatedKey(null);
          }}
        />
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <FormField label="Key name" htmlFor="api-key-name">
          <Input
            id="api-key-name"
            type="text"
            value={name}
            maxLength={100}
            placeholder="e.g. CI deploy bot"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FormField>
        <FormField label="Expiration" htmlFor="api-key-expiry">
          <Select
            value={expiry}
            onChange={(value: string) => {
              setExpiry(value);
            }}
            aria-label="API key expiration"
            className="max-w-xs"
          >
            {EXPIRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
        {formError !== null ? <Alert tone="danger">{formError}</Alert> : null}
        {createKey.isError ? (
          <Alert tone="danger">{createKey.error?.message ?? 'Failed to create key'}</Alert>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={createKey.isPending || name.trim() === ''}>
            {createKey.isPending ? 'Creating…' : 'Create API key'}
          </Button>
        </div>
      </form>

      <div className="border rounded-md">
        <div className="p-3">
          <Text size="sm">Your keys</Text>
        </div>
        {isLoading ? (
          <Text size="sm" tone="muted" className="p-3 border-t">
            Loading…
          </Text>
        ) : keys.length === 0 ? (
          <Text size="sm" tone="muted" className="p-3 border-t">
            You have no API keys yet.
          </Text>
        ) : (
          keys.map((apiKey) => (
            <ApiKeyRow
              key={apiKey.id}
              apiKey={apiKey}
              isRevoking={deleteKey.isPending}
              onRevoke={(id) => {
                deleteKey.mutate(id);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
};
