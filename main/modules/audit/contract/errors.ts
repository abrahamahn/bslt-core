// main/modules/audit/contract/errors.ts
import { defineErrors } from '@bslt/contract';

export const auditErrors = defineErrors('audit', {
  SECURITY_EVENT_NOT_FOUND: 404,
});
