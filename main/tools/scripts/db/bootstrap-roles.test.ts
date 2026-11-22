// main/tools/scripts/db/bootstrap-roles.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBootstrap, mockClose, mockCreateRawDb, mockInitEnv, mockResolve } = vi.hoisted(() => ({
  mockBootstrap: vi.fn(),
  mockClose: vi.fn(),
  mockCreateRawDb: vi.fn(),
  mockInitEnv: vi.fn(),
  mockResolve: vi.fn(),
}));

vi.mock('@bslt/db', () => ({
  bootstrapDatabaseRoles: mockBootstrap,
  createRawDb: mockCreateRawDb,
  resolveRoleBootstrapEnv: mockResolve,
}));

vi.mock('@bslt/server-system/config', () => ({ initEnv: mockInitEnv }));

const PASSWORDS = { owner: 'o'.repeat(20), app: 'a'.repeat(20), worker: 'w'.repeat(20) };

describe('bootstrapRoles', () => {
  beforeEach(() => {
    mockInitEnv.mockResolvedValue(undefined);
    mockResolve.mockReturnValue({
      adminConnectionString: 'postgres://postgres:admin@db:5432/app',
      passwords: PASSWORDS,
    });
    mockClose.mockResolvedValue(undefined);
    mockCreateRawDb.mockReturnValue({ close: mockClose });
    mockBootstrap.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads env first, then bootstraps through the admin connection', async () => {
    const { bootstrapRoles } = await import('./bootstrap-roles');

    await bootstrapRoles();

    expect(mockInitEnv.mock.invocationCallOrder[0]).toBeLessThan(
      mockResolve.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mockCreateRawDb).toHaveBeenCalledWith('postgres://postgres:admin@db:5432/app');
    expect(mockBootstrap).toHaveBeenCalledWith({ close: mockClose }, PASSWORDS);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('closes the admin connection when the bootstrap fails, and reports the failure', async () => {
    mockBootstrap.mockRejectedValue(new Error('must be superuser to alter superuser roles'));
    const { bootstrapRoles } = await import('./bootstrap-roles');

    await expect(bootstrapRoles()).rejects.toThrow(/must be superuser/);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('never connects when the role URLs are missing or wrong', async () => {
    mockResolve.mockImplementation(() => {
      throw new Error('WORKER_DATABASE_URL must connect as bslt_worker');
    });
    const { bootstrapRoles } = await import('./bootstrap-roles');

    await expect(bootstrapRoles()).rejects.toThrow(/WORKER_DATABASE_URL/);
    expect(mockCreateRawDb).not.toHaveBeenCalled();
    expect(mockBootstrap).not.toHaveBeenCalled();
  });
});
