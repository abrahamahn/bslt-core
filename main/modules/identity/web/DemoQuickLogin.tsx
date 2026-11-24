// main/modules/identity/web/DemoQuickLogin.tsx
import { type ReactElement } from 'react';

import { Badge, Button, Text } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

interface DemoPersona {
  readonly label: string;
  readonly role: string;
  readonly email: string;
  readonly password: string;
}

const DEMO_PERSONAS: readonly DemoPersona[] = [
  {
    label: 'Platform Admin',
    role: 'admin',
    email: 'admin@example.com',
    password: 'password123',
  },
  {
    label: 'Workspace Admin',
    role: 'user',
    email: 'user@example.com',
    password: 'password123',
  },
  {
    label: 'Demo Member',
    role: 'user',
    email: 'demo@example.com',
    password: 'password123',
  },
];

interface DemoQuickLoginProps {
  readonly enabled: boolean;
  readonly disabled?: boolean | undefined;
  readonly onSelect: (email: string, password: string) => void;
}

export function isDemoModeEnabled(): boolean {
  try {
    const env = (import.meta as unknown as { readonly env?: Readonly<Record<string, unknown>> })
      .env;
    return env?.['VITE_DEMO_MODE'] === 'true';
  } catch {
    return false;
  }
}

export function DemoQuickLogin({
  enabled,
  disabled = false,
  onSelect,
}: DemoQuickLoginProps): ReactElement | null {
  const t = useModuleMessages(enUsMessages);
  if (!enabled) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="demo-quick-login">
      <div className="flex items-center justify-between gap-2">
        <Text size="xs" tone="muted">
          {t('identity.demoQuickLogin.heading')}
        </Text>
        <Badge tone="info">{t('identity.demoQuickLogin.badge')}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {DEMO_PERSONAS.map((persona) => (
          <Button
            key={persona.email}
            type="button"
            variant="secondary"
            size="small"
            disabled={disabled}
            onClick={() => {
              onSelect(persona.email, persona.password);
            }}
          >
            {persona.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
