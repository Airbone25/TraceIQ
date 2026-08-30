import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCloseTargetPools, encryption } = vi.hoisted(() => ({
  mockCloseTargetPools: vi.fn().mockResolvedValue(undefined),
  encryption: { encryptSecret: () => 'enc:v1', decryptSecret: (enc) => (enc === 'enc-pw' ? 'plain-pw' : 'secrets') },
}));

vi.mock('../database/target-pools.js', () => ({
  closeTargetPools: mockCloseTargetPools,
}));

vi.mock('../utils/crypto.js', () => ({
  encryptSecret: encryption.encryptSecret,
  decryptSecret: encryption.decryptSecret,
}));

const mockModel = vi.hoisted(() => ({}));
const { doc, findResult } = vi.hoisted(() => ({
  doc: (over = {}) => ({
    _id: { toString: () => over.id || 'c1' },
    name: over.name ?? 'Prod',
    host: over.host ?? 'db.internal',
    port: over.port ?? 3307,
    user: over.user ?? 'reader',
    passwordEnc: over.passwordEnc ?? 'enc-pw',
    useSsl: over.useSsl ?? false,
    lastUsedAt: over.lastUsedAt ?? null,
    created_at: over.created_at ?? '2024-01-01',
  }),
  findResult: (docs) => ({ sort: () => docs }),
}));

vi.mock('../database/collections/index.js', () => ({
  Connection: mockModel,
}));

import {
  createConnection,
  listConnections,
  getConnectionRow,
  getConnectionCredentials,
  deleteConnection,
} from '../database/connection-store.js';

describe('Connection Store (Mongoose)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCloseTargetPools.mockResolvedValue(undefined);
    mockModel.create = vi.fn();
    mockModel.find = vi.fn();
    mockModel.findById = vi.fn();
    mockModel.findOne = vi.fn();
    mockModel.deleteOne = vi.fn();
    mockModel.updateOne = vi.fn();
  });

  it('should store an encrypted password and return a public row without credentials', async () => {
    mockModel.create.mockResolvedValue(doc({ id: 'c-new' }));

    const created = await createConnection({
      name: 'Prod', host: 'db.internal', port: 3307, user: 'reader', password: 'super-secret', userId: 'user-1',
    });

    expect(mockModel.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Prod', host: 'db.internal', port: 3307, user: 'reader', userId: 'user-1',
    }));
    const arg = mockModel.create.mock.calls[0][0];
    expect(arg.passwordEnc).toBe('enc:v1');
    expect(arg.password).toBeUndefined();
    expect(created).toEqual({ id: 'c-new', name: 'Prod', host: 'db.internal', port: 3307, user: 'reader' });
  });

  it('should map a duplicate name to ER_DUP_ENTRY error', async () => {
    mockModel.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    await expect(createConnection({ name: 'Prod', host: 'h', user: 'u', password: 'p', userId: 'u1' }))
      .rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });

  it('should list connections as snake_case rows without any credential fields', async () => {
    mockModel.find.mockReturnValue(findResult([doc({ id: 'c1' })]));

    const rows = await listConnections('user-1');
    expect(rows[0]).toMatchObject({ id: 'c1', name: 'Prod', host: 'db.internal', port: 3307, user: 'reader', created_at: '2024-01-01' });
    expect(rows[0].last_used_at).toBeNull();
    expect(rows[0]).not.toHaveProperty('password');
    expect(rows[0]).not.toHaveProperty('passwordEnc');
  });

  it('should fetch a connection row by id scoped to a user', async () => {
    mockModel.findOne.mockResolvedValue(doc({ id: 'c2' }));
    const row = await getConnectionRow('c2', 'user-1');
    expect(mockModel.findOne).toHaveBeenCalledWith({ _id: 'c2', userId: 'user-1' });
    expect(row).toMatchObject({ id: 'c2', name: 'Prod', host: 'db.internal' });
    expect(row.password).toBeUndefined();
  });

  it('should return decrypted credentials for target investigation', async () => {
    mockModel.findById.mockResolvedValue(doc({ id: 'c1', passwordEnc: 'enc-pw' }));
    const creds = await getConnectionCredentials('c1');
    expect(creds).toMatchObject({ host: 'db.internal', port: 3307, user: 'reader', password: 'plain-pw' });
  });

  it('should delete a connection and close its ephemeral target pools', async () => {
    mockModel.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const deleted = await deleteConnection('conn-9');
    expect(deleted).toBe(true);
    expect(mockModel.deleteOne).toHaveBeenCalledWith({ _id: 'conn-9' });
    expect(mockCloseTargetPools).toHaveBeenCalledWith('conn-9');
  });

  it('should return false when no document was deleted', async () => {
    mockModel.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const deleted = await deleteConnection('missing');
    expect(deleted).toBe(false);
  });
});
