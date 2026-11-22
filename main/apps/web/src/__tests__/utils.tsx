// main/apps/web/src/__tests__/utils.tsx
import { createTransport, QueryCache } from '@bslt/client-engine';
import { MemoryRouter, QueryCacheProvider } from '@bslt/react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { getAccessToken } from '../app/authToken';
import { ClientEnvironmentProvider } from '../app/ClientEnvironment';

import type { ClientEnvironment } from '../app/ClientEnvironment';
import type { ClientConfig } from '../config';
import type { CapabilityContext } from '@bslt/contract';
import type { User } from '@bslt/identity/contract';
import type { AuthService, AuthState } from '@bslt/identity/web';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

export const mockUser: User = {
  id: 'user-123',
  email: 'test@example.com',
  username: 'testuser',
  firstName: 'Test',
  lastName: 'User',
  role: 'user',
  emailVerified: true,
  phone: null,
  phoneVerified: null,
  dateOfBirth: null,
  gender: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

export const mockAdminUser: User = {
  ...mockUser,
  id: 'admin-123',
  email: 'admin@example.com',
  username: 'adminuser',
  firstName: 'Admin',
  role: 'admin',
};

export const mockConfig: ClientConfig = {
  mode: 'test',
  isDev: false,
  isProd: false,
  apiUrl: 'http://localhost:3000/api',
  appName: 'Your App',
  stripePublishableKey: 'pk_test_123',
  tokenRefreshInterval: 13 * 60 * 1000,
  uiVersion: '1.0.0',
  queryPersistence: {
    maxAge: 24 * 60 * 60 * 1000,
    throttleTime: 1000,
  },
};

export interface MockAuthServiceOptions {
  user?: User;
  isLoading?: boolean;
  isAuthenticated?: boolean;
  loginError?: Error;
  registerError?: Error;
  logoutError?: Error;
}

export function createMockAuthService(options: MockAuthServiceOptions = {}): AuthService {
  const {
    user = null,
    isLoading = false,
    isAuthenticated = user !== null,
    loginError,
    registerError,
    logoutError,
  } = options;

  const state: AuthState = {
    user,
    isLoading,
    isAuthenticated,
    isNewDevice: false,
    impersonation: null,
  };
  const listeners = new Set<() => void>();

  const updateState = (newState: Partial<AuthState>): void => {
    Object.assign(state, newState);
    for (const listener of listeners) listener();
  };

  return {
    getState: () => ({ ...state }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    initialize: () => {
      updateState({ isLoading: false });
      return Promise.resolve(state.user);
    },
    login: () => {
      if (loginError !== undefined) return Promise.reject(loginError);
      updateState({ user: mockUser, isAuthenticated: true });
      return Promise.resolve();
    },
    register: () => {
      if (registerError !== undefined) return Promise.reject(registerError);
      return Promise.resolve({
        message: 'Please check your email to verify your account',
        email: 'test@example.com',
      });
    },
    logout: () => {
      if (logoutError !== undefined) return Promise.reject(logoutError);
      updateState({ user: null, isAuthenticated: false });
      return Promise.resolve();
    },
    refreshToken: () => Promise.resolve(true),
    fetchCurrentUser: () => Promise.resolve(state.user),
    startImpersonation: () => Promise.resolve(),
    endImpersonation: () => Promise.resolve(),
    forgotPassword: () => Promise.resolve({ message: 'Password reset email sent' }),
    resetPassword: () => Promise.resolve({ message: 'Password reset successful' }),
    verifyEmail: () =>
      Promise.resolve({
        verified: true,
        message: 'Email verified',
        token: 'test-token',
        user: mockUser,
      }),
    resendVerification: () => Promise.resolve({ message: 'Verification email sent' }),
    verifyTotpLogin: () => Promise.resolve(),
    dismissNewDeviceBanner: () => {
      updateState({ isNewDevice: false });
    },
    destroy: () => {
      listeners.clear();
    },
  } as unknown as AuthService;
}

export interface MockEnvironmentOptions extends MockAuthServiceOptions {
  config?: Partial<ClientConfig>;
  capabilities?: CapabilityContext;
}

export function createMockEnvironment(options: MockEnvironmentOptions = {}): ClientEnvironment {
  const { config: configOverrides, capabilities, ...authOptions } = options;

  const queryCache = new QueryCache({
    defaultStaleTime: 0,
    defaultGcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const resolvedConfig: ClientConfig = {
    ...mockConfig,
    ...configOverrides,
    queryPersistence: {
      maxAge: configOverrides?.queryPersistence?.maxAge ?? mockConfig.queryPersistence.maxAge,
      throttleTime:
        configOverrides?.queryPersistence?.throttleTime ?? mockConfig.queryPersistence.throttleTime,
    },
  };

  return {
    config: resolvedConfig,
    queryCache,
    auth: createMockAuthService(authOptions),
    transport: createTransport({
      baseUrl: resolvedConfig.apiUrl,
      getToken: getAccessToken,
    }),
    ...(capabilities !== undefined ? { initialCapabilities: capabilities } : {}),
  };
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  environment?: ClientEnvironment;
  initialEntries?: string[];
  route?: string;
}

export interface RenderWithProvidersResult extends RenderResult {
  user: ReturnType<typeof userEvent.setup>;
  environment: ClientEnvironment;
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const {
    environment = createMockEnvironment(),
    initialEntries = ['/'],
    route,
    ...renderOptions
  } = options;
  const entries = route !== undefined ? [route] : initialEntries;

  const Wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryCacheProvider cache={environment.queryCache}>
      <MemoryRouter initialEntries={entries}>
        <ClientEnvironmentProvider value={environment}>{children}</ClientEnvironmentProvider>
      </MemoryRouter>
    </QueryCacheProvider>
  );

  const user = userEvent.setup();

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    user,
    environment,
  };
}
