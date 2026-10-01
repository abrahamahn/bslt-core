// main/apps/web/src/pages/EmailUnsubscribePage.tsx
/**
 * EmailUnsubscribePage
 *
 * Public page opened from email unsubscribe links.
 */

import { useClientEnvironment } from '@app/ClientEnvironment';
import { createGeneratedApiClient } from '@bslt/api';
import { useQuery } from '@bslt/react';
import { useParams, useSearchParams } from '@bslt/react/router';
import { Alert, Button, Card, Heading, Skeleton } from '@bslt/ui';
import { useMemo } from 'react';

import type { GeneratedApiPath } from '@bslt/api';
import type { ReactElement } from 'react';

type EmailUnsubscribeResponse = {
  message?: string;
};

function parseEmailUnsubscribeResponse(value: unknown): EmailUnsubscribeResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const message = (value as Record<string, unknown>)['message'];
  return typeof message === 'string' ? { message } : {};
}

export const EmailUnsubscribePage = (): ReactElement => {
  const { config } = useClientEnvironment();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const token = params['token'] ?? null;
  const userId = searchParams.get('uid');
  const category = searchParams.get('cat');
  const api = useMemo(
    () =>
      createGeneratedApiClient({
        baseUrl: config.apiUrl,
      }),
    [config.apiUrl],
  );

  const query = useQuery<EmailUnsubscribeResponse>({
    queryKey: ['email-unsubscribe', token ?? '', userId ?? '', category ?? ''],
    queryFn: async (): Promise<EmailUnsubscribeResponse> => {
      if (token === null || token === '') {
        throw new Error('Unsubscribe token is missing');
      }
      if (userId === null || userId === '' || category === null || category === '') {
        throw new Error('Unsubscribe link is missing required parameters');
      }

      const response = await api.request({
        path: `/api/email/unsubscribe/${encodeURIComponent(token)}` as GeneratedApiPath,
        method: 'GET',
        query: { uid: userId, cat: category },
      });
      return parseEmailUnsubscribeResponse(response);
    },
    enabled: token !== null,
  });

  return (
    <div className="flex items-center justify-center px-4" style={{ minHeight: '60dvh' }}>
      <Card className="w-full max-w-md">
        <Card.Body>
          <Heading as="h1" size="lg" className="mb-3">
            Email Preferences
          </Heading>
          {query.isLoading ? (
            <div className="space-y-3">
              <Skeleton height="1.25rem" className="w-full" />
              <Skeleton height="1.25rem" width="66.667%" />
            </div>
          ) : query.error !== null ? (
            <Alert tone="danger">{query.error.message}</Alert>
          ) : (
            <Alert tone="success">
              {query.data?.message ?? 'You have been unsubscribed from this email.'}
            </Alert>
          )}
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            onClick={() => {
              window.location.href = '/settings';
            }}
          >
            Open Settings
          </Button>
        </Card.Body>
      </Card>
    </div>
  );
};
