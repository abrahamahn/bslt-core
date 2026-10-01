// main/server/core/src/auth/routes.ts
/**
 * Auth Routes
 *
 * Public auth route assembly. Individual route slices live under
 * `auth/routes/*`; this file stays as the stable public entrypoint.
 */

import { createRouteMap } from '@bslt/server-system/http';

import { magicLinkRouteEntries } from './magic-link';
import { oauthRouteEntries } from './oauth';
import { emailOtpRouteEntries } from './otp';
import { accountRouteEntries } from './routes/account';
import { factorRouteEntries } from './routes/factors';
import { passwordRouteEntries } from './routes/password';
import { sessionRouteEntries } from './routes/session';
import { verificationRouteEntries } from './routes/verification';
import { webauthnRouteEntries } from './webauthn';

export const authRoutes = createRouteMap([
  ...sessionRouteEntries,
  ...accountRouteEntries,
  ...passwordRouteEntries,
  ...verificationRouteEntries,
  ...factorRouteEntries,
  ...magicLinkRouteEntries,
  ...emailOtpRouteEntries,
  ...oauthRouteEntries,
  ...webauthnRouteEntries,
]);
