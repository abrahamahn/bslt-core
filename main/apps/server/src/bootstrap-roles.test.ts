// main/apps/server/src/bootstrap-roles.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runContainerRoleBootstrap } from './bootstrap-roles';

const { mockBootstrap, mockClose, mockCreateRawDb, mockResolve } = vi.hoisted(() => ({
  mockBootstrap: vi.fn(),
  mockClose: vi.fn(),
  mockCreateRawDb: vi.fn(),
  mockResolve: vi.fn(),
}));

vi.mock('@bslt/db', () => ({
  bootstrapDatabaseRoles: mockBootstrap,
  createRawDb: mockCreateRawDb,
  resolveRoleBootstrapEnv: mockResolve,
}));

vi.mock('@bslt/server-system/config', () => ({
  initEnv: vi.fn().mockResolvedValue(undefined),
}));

const PASSWORDS = { owner: 'o'.repeat(20), app: 'a'.repeat(20), worker: 'w'.repeat(20) };

describe('runContainerRoleBootstrap', () => {
  beforeEach(() => {
    mockResolve.mockReturnValue({
      adminConnectionString: 'postgres://postgres:admin@postgres:5432/app',
      passwords: PASSWORDS,
    });
    mockClose.mockResolvedValue(undefined);
    mockCreateRawDb.mockReturnValue({ close: mockClose });
    mockBootstrap.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('bootstraps the roles through the admin connection and closes it', async () => {
    await runContainerRoleBootstrap();

    expect(mockCreateRawDb).toHaveBeenCalledWith('postgres://postgres:admin@postgres:5432/app');
    expect(mockBootstrap).toHaveBeenCalledWith({ close: mockClose }, PASSWORDS);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('closes the admin connection even when the bootstrap is refused', async () => {
    mockBootstrap.mockRejectedValue(new Error('permission denied to create role'));

    await expect(runContainerRoleBootstrap()).rejects.toThrow(/permission denied/);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('does not connect at all when the role URLs are inconsistent', async () => {
    mockResolve.mockImplementation(() => {
      throw new Error('DATABASE_URL must connect as bslt_app');
    });

    await expect(runContainerRoleBootstrap()).rejects.toThrow(/bslt_app/);
    expect(mockCreateRawDb).not.toHaveBeenCalled();
  });
});
