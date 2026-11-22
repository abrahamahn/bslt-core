// bslt.config.ts
import { auditModule } from '@bslt/audit/module';
import { complianceModule } from '@bslt/compliance/module';
import { defineConfig } from '@bslt/contract';
import { devtoolsModule } from '@bslt/devtools/module';
import { identityModule } from '@bslt/identity/module';

export default defineConfig({
  name: 'BSLT',
  installedModules: [identityModule, complianceModule, auditModule] as const,
  devOnly: [devtoolsModule],
  locales: ['en-US'],
  brand: {
    accent: 'oklch(0.62 0.19 264)',
    logo: '/brand/logo.svg',
  },
});
