import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery, mockCloseTargetPools } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockCloseTargetPools: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../database/mysql.js', () => ({
  query: mockQuery,
  rawQuery: vi.fn(),
}));

vi.mock('../database/target-pools.js', () => ({
  closeTargetPools: mockCloseTargetPools,
}));

vi.mock('../config/env.js', () => ({
  default: { APP_SECRET: 'b'.repeat(64) },
}));

import {
  createConnection,
  listConnections,
  getConnectionCredentials,
  deleteConnection,
} from '../database/connection-store.js';

describe('Connection Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCloseTargetPools.mockResolvedValue(undefined);
  });

  it('should encrypt the password before insert and never return it', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const created = await createConnection({
      name: 'Prod',
      host: 'db.internal',
      port: 3307,
      user: 'reader',
      password: 'super-secret',
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO db_connections');
    expect(params[5]).not.toContain('super-secret');
    expect(params[5]).toMatch(/^v1:/);
    expect(created).toEqual({ id: params[0], name: 'Prod', host: 'db.internal', port: 3307, user: 'reader' });
  });

  it('should list connections without the encrypted column', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'c1', name: 'Prod' }]);
    const rows = await listConnections();
    expect(mockQuery.mock.calls[0][0]).not.toContain('password_enc');
    expect(rows).toEqual([{ id: 'c1', name: 'Prod' }]);
  });

  it('should decrypt credentials on retrieval', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const { id } = await createConnection({
      name: 'X',
      host: 'h',
      port: 3306,
      user: 'u',
      password: 'plain-pw',
    });
    const ciphertext = mockQuery.mock.calls[0][1][5];

    mockQuery.mockResolvedValueOnce([{
      id,
      host: 'h',
      port: 3306,
      db_user: 'u',
      password_enc: ciphertext,
    }]);
    const creds = await getConnectionCredentials(id);

    expect(creds).toEqual({ host: 'h', port: 3306, user: 'u', password: 'plain-pw' });
  });

  it('should close target pools when a connection is deleted', async () => {
    mockQuery
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValue([]);

    const deleted = await deleteConnection('conn-9');

    expect(deleted).toBe(true);
    expect(mockCloseTargetPools).toHaveBeenCalledWith('conn-9');
  });
});
