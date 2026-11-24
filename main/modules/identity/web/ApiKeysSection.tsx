// main/modules/identity/web/ApiKeysSection.tsx
import { useState, type ReactElement } from 'react';

import { Alert, Badge, Button, Checkbox, FormField, Input, Select, Text } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import { useApiKeys, useCreateApiKey, useDeleteApiKey } from './hooks';

import type { ApiKey, CreatedApiKey } from '../contract';

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function maskedLabel(key: ApiKey): string {
  return `${key.keyPrefix}…${key.last4}`;
}

const CreatedKeyAlert = ({
  createdKey,
  onDismiss,
}: {
  readonly createdKey: CreatedApiKey;
  readonly onDismiss: () => void;
}): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const handleCopy = (): void => {
    setCopyError(null);
    navigator.clipboard
      .writeText(createdKey.token)
      .then(() => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 2000);
      })
      .catch(() => {
        setCopyError(t('identity.apiKeys.copyFailed'));
      });
  };

  return (
    <Alert tone="success">
      <div className="flex flex-col gap-2">
        <Text size="sm">{t('identity.apiKeys.createdPrompt')}</Text>
        <code className="bg-surface border rounded p-2 break-all">{createdKey.token}</code>
        {copyError !== null ? <Alert tone="danger">{copyError}</Alert> : null}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="text" size="small" onClick={handleCopy}>
            {copied ? t('identity.apiKeys.copiedButton') : t('identity.apiKeys.copyButton')}
          </Button>
          <Button type="button" variant="secondary" size="small" onClick={onDismiss}>
            {t('identity.apiKeys.doneButton')}
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
  readonly apiKey: ApiKey;
  readonly onRevoke: (id: string) => void;
  readonly isRevoking: boolean;
}): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [confirming, setConfirming] = useState(false);

  const createdMeta = `${t('identity.apiKeys.createdPrefix')}${formatShortDate(apiKey.createdAt)}`;
  const usedMeta =
    apiKey.lastUsedAt !== null
      ? `${t('identity.apiKeys.lastUsedPrefix')}${formatShortDate(apiKey.lastUsedAt)}`
      : t('identity.apiKeys.neverUsed');
  const expiresMeta =
    apiKey.expiresAt !== null
      ? `${t('identity.apiKeys.expiresPrefix')}${formatShortDate(apiKey.expiresAt)}`
      : '';
  const metaSummary = `${createdMeta}${usedMeta}${expiresMeta}`;

  return (
    <div className="flex items-center justify-between gap-3 border-t p-3">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Text size="sm">{apiKey.name}</Text>
          {apiKey.orgId !== null ? (
            <Badge tone="info">{t('identity.apiKeys.workspaceScopedBadge')}</Badge>
          ) : null}
          {apiKey.scopes.map((scope) => (
            <Badge key={scope} tone="neutral">
              {scope}
            </Badge>
          ))}
        </div>
        <Text size="xs" tone="muted">
          <code>{maskedLabel(apiKey)}</code>
          {metaSummary}
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
            {isRevoking
              ? t('identity.apiKeys.revokingButton')
              : t('identity.apiKeys.confirmButton')}
          </Button>
          <Button
            type="button"
            variant="text"
            size="small"
            onClick={() => {
              setConfirming(false);
            }}
          >
            {t('identity.apiKeys.cancelButton')}
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
          {t('identity.apiKeys.revokeButton')}
        </Button>
      )}
    </div>
  );
};

export const ApiKeysSection = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const { data: keys, isLoading } = useApiKeys();
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<string>('never');
  const [scopesInput, setScopesInput] = useState('');
  const [scopeToWorkspace, setScopeToWorkspace] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const createKey = useCreateApiKey({
    onSuccess: (response) => {
      setCreatedKey(response.key);
      setName('');
      setExpiry('never');
      setScopesInput('');
      setScopeToWorkspace(false);
    },
  });
  const deleteKey = useDeleteApiKey();

  const expiryOptions: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
    readonly days: number | null;
  }> = [
    { value: 'never', label: t('identity.apiKeys.expiryNever'), days: null },
    { value: '30', label: t('identity.apiKeys.expiry30'), days: 30 },
    { value: '90', label: t('identity.apiKeys.expiry90'), days: 90 },
    { value: '365', label: t('identity.apiKeys.expiry365'), days: 365 },
  ];

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setFormError(t('identity.apiKeys.nameRequired'));
      return;
    }
    const days = expiryOptions.find((option) => option.value === expiry)?.days ?? null;
    const scopes = scopesInput
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);
    createKey.create({
      name: trimmed,
      expiresInDays: days,
      ...(scopes.length > 0 ? { scopes } : {}),
      ...(scopeToWorkspace ? { scopeToWorkspace: true } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Text size="sm" tone="muted">
        {t('identity.apiKeys.introPrefix')}
        <code>{t('identity.apiKeys.introHeaderCode')}</code>
        {t('identity.apiKeys.introSuffix')}
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
        <FormField label={t('identity.apiKeys.nameLabel')} htmlFor="api-key-name">
          <Input
            id="api-key-name"
            type="text"
            value={name}
            maxLength={100}
            placeholder={t('identity.apiKeys.namePlaceholder')}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FormField>
        <FormField label={t('identity.apiKeys.expiryLabel')} htmlFor="api-key-expiry">
          <Select
            value={expiry}
            onChange={(value: string) => {
              setExpiry(value);
            }}
            aria-label={t('identity.apiKeys.expiryAria')}
            className="max-w-xs"
          >
            {expiryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('identity.apiKeys.scopesLabel')} htmlFor="api-key-scopes">
          <Input
            id="api-key-scopes"
            type="text"
            value={scopesInput}
            placeholder={t('identity.apiKeys.scopesPlaceholder')}
            onChange={(e) => {
              setScopesInput(e.target.value);
            }}
          />
        </FormField>
        <Checkbox
          id="api-key-workspace-scope"
          checked={scopeToWorkspace}
          onChange={setScopeToWorkspace}
          label={t('identity.apiKeys.scopeToWorkspaceLabel')}
        />
        {formError !== null ? <Alert tone="danger">{formError}</Alert> : null}
        {createKey.isError ? (
          <Alert tone="danger">
            {createKey.error?.message ?? t('identity.apiKeys.createErrorFallback')}
          </Alert>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={createKey.isPending || name.trim() === ''}>
            {createKey.isPending
              ? t('identity.apiKeys.submitCreating')
              : t('identity.apiKeys.submitCreate')}
          </Button>
        </div>
      </form>

      <div className="border rounded-md">
        <div className="p-3">
          <Text size="sm">{t('identity.apiKeys.listHeading')}</Text>
        </div>
        {isLoading ? (
          <Text size="sm" tone="muted" className="p-3 border-t">
            {t('identity.apiKeys.loading')}
          </Text>
        ) : keys.length === 0 ? (
          <Text size="sm" tone="muted" className="p-3 border-t">
            {t('identity.apiKeys.empty')}
          </Text>
        ) : (
          keys.map((apiKey) => (
            <ApiKeyRow
              key={apiKey.id}
              apiKey={apiKey}
              isRevoking={deleteKey.isPending}
              onRevoke={(id) => {
                deleteKey.revoke(id);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
};
