import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../database/mysql.js', () => ({
  query: mockQuery,
  rawQuery: vi.fn(),
}));

import {
  createUser,
  getUserByEmail,
  getUserById,
  verifyPassword,
} from '../database/user-store.js';

describe('User Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([]);
  });

  it('should store a bcrypt hash and normalized email, never the plaintext', async () => {
    const created = await createUser({ email: '  Alice@Example.COM ', password: 'hunter2222' });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO users');
    expect(params[1]).toBe('alice@example.com');
    expect(params[2]).not.toBe('hunter2222');
    expect(params[2]).toMatch(/^\$2[aby]\$/);
    expect(created.email).toBe('alice@example.com');
  });

  it('should return the raw row for login lookups by email', async () => {
    const row = { id: 'u1', email: 'a@b.com', password_hash: '$2a$10$x' };
    mockQuery.mockResolvedValueOnce([row]);
    const found = await getUserByEmail('A@B.com');
    expect(mockQuery.mock.calls[0][1]).toEqual(['a@b.com']);
    expect(found.password_hash).toBe('$2a$10$x');
  });

  it('should omit the hash when loading a user by id', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'u1', email: 'a@b.com' }]);
    const user = await getUserById('u1');
    expect(mockQuery.mock.calls[0][0]).not.toContain('password_hash');
    expect(user).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it('should verify a password against its hash', async () => {
    mockQuery.mockResolvedValue([]);
    const created = await createUser({ email: 'v@test.com', password: 'correct-horse' });
    const [, params] = mockQuery.mock.calls[0];

    expect(await verifyPassword('correct-horse', params[2])).toBe(true);
    expect(await verifyPassword('wrong', params[2])).toBe(false);
    expect(created.id).toBeTruthy();
  });
});
