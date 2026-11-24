// main/modules/devtools/server/index.ts
import { clearCapturedDevEmails, listCapturedDevEmails } from '@bslt/contract';
import { implementServer } from '@bslt/server-system/module';

import { devtoolsModule } from '../module';

import { buildRouteManifest } from './service';

import type {
  ClearDevEmailsResponse,
  DevEmailInboxResponse,
  RouteManifestResponse,
} from '../contract';

type DevtoolsService = {
  readonly readManifest: () => RouteManifestResponse;
  readonly readDevEmails: () => DevEmailInboxResponse;
  readonly clearDevEmails: () => ClearDevEmailsResponse;
};

export const devtoolsServer = implementServer(devtoolsModule, {
  create: (k): DevtoolsService => {
    const isProduction = k.env.NODE_ENV === 'production';
    return {
      readManifest: () => buildRouteManifest(),
      readDevEmails: () => {
        if (isProduction) {
          return { emails: [], count: 0 };
        }
        const emails = listCapturedDevEmails().map((entry) => ({
          id: entry.id,
          to: [...entry.to],
          subject: entry.subject,
          text: entry.text,
          html: entry.html,
          links: [...entry.links],
          sentAt: entry.sentAt,
        }));
        return { emails, count: emails.length };
      },
      clearDevEmails: () => {
        if (isProduction) {
          return { cleared: 0 };
        }
        return { cleared: clearCapturedDevEmails() };
      },
    };
  },
  handlers: {
    getRouteManifest: (_input, _req, s) => Promise.resolve(s.readManifest()),
    listDevEmails: (_input, _req, s) => Promise.resolve(s.readDevEmails()),
    clearDevEmails: (_input, _req, s) => Promise.resolve(s.clearDevEmails()),
  },
});
