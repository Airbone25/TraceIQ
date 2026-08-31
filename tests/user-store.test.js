import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => {
  const users = [];
  const keys = [];
  let userSeq = 0;
  let keySeq = 0;

  function userDoc(data) {
    return {
      _id: { toString: () => data.id },
      email: data.email,
      passwordHash: data.passwordHash,
      groqConfigured: data.groqConfigured ?? false,
      emailVerified: data.emailVerified ?? false,
      otpCodeHash: data.otpCodeHash ?? null,
      otpExpiresAt: data.otpExpiresAt ?? null,
      otpAttempts: data.otpAttempts ?? 0,
      otpResendAt: data.otpResendAt ?? null,
      created_at: data.created_at || null,
    };
  }

  function keyDoc(data) {
    return {
      _id: { toString: () => data.id },
      userId: data.userId,
      name: data.name || 'default',
      apiKeyEnc: data.apiKeyEnc || null,
      model: data.model || null,
      active: data.active ?? true,
      save: vi.fn(async function () {
        const idx = keys.findIndex(k => k._id.toString() === this._id.toString());
        if (idx !== -1) keys[idx] = this;
      }),
    };
  }

  const User = {
    create: vi.fn(async (d) => {
      const id = 'u' + (++userSeq);
      const doc = userDoc({ id, ...d });
      users.push(doc);
      return doc;
    }),
    findOne: vi.fn(async (q) => users.find(u => (!q.email || u.email === q.email) && (!q._id || u._id.toString() === String(q._id))) || null),
    findById: vi.fn(async (id) => users.find(u => u._id.toString() === String(id)) || null),
    updateOne: vi.fn(async (q, set) => {
      const u = users.find(x => x._id.toString() === String(q._id));
      if (u && set?.$set) Object.assign(u, set.$set);
      return { modifiedCount: u ? 1 : 0 };
    }),
    deleteOne: vi.fn(async (q) => {
      const i = users.findIndex(x => x._id.toString() === String(q._id));
      if (i !== -1) { users.splice(i, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    }),
    countDocuments: vi.fn(async () => users.length),
  };

  const GroqKey = {
    create: vi.fn(async (d) => {
      const id = 'k' + (++keySeq);
      const doc = keyDoc({ id, ...d });
      keys.push(doc);
      return doc;
    }),
    findOne: vi.fn(async (q) => keys.find(k =>
      (!q.userId || String(k.userId) === String(q.userId)) &&
      (!q.name || k.name === q.name) &&
      (q.active === undefined || k.active === q.active)
    ) || null),
    deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
  };

  return { User, GroqKey, users, keys };
});

vi.mock('../database/collections/index.js', () => ({
  User: fake.User,
  GroqKey: fake.GroqKey,
  Connection: { deleteMany: vi.fn(async () => ({ deletedCount: 0 })) },
  Thread: { deleteMany: vi.fn(async () => ({ deletedCount: 0 })) },
  Message: { deleteMany: vi.fn(async () => ({ deletedCount: 0 })) },
  Investigation: { find: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ deletedCount: 0 })) },
  Step: { deleteMany: vi.fn(async () => ({ deletedCount: 0 })) },
}));

import {
  createUser,
  getUserByEmail,
  getUserById,
  verifyPassword,
  getUserGroqConfig,
  setUserGroqConfig,
  getUserVerification,
  saveUserVerification,
  markEmailVerified,
  incrementOtpAttempts,
} from '../database/user-store.js';

describe('User Store (Mongoose)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.users.length = 0;
    fake.keys.length = 0;
  });

  it('should store a bcrypt hash and normalized email, never the plaintext', async () => {
    const created = await createUser({ email: '  Alice@Example.COM ', password: 'hunter2222' });
    expect(created.email).toBe('alice@example.com');
    expect(fake.users[0].passwordHash).not.toBe('hunter2222');
    expect(fake.users[0].passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('should return the raw row with hash for login lookups by email', async () => {
    await createUser({ email: 'a@b.com', password: 'hunter2222' });
    const found = await getUserByEmail('A@B.com');
    expect(found.id).toBeTruthy();
    expect(found.password_hash).toMatch(/^\$2[aby]\$/);
  });

  it('should omit the hash when loading a user by id', async () => {
    const created = await createUser({ email: 'a@b.com', password: 'hunter2222' });
    const user = await getUserById(created.id);
    expect(user.id).toBe(created.id);
    expect(user.email).toBe('a@b.com');
    expect(user.password_hash).toBeUndefined();
  });

  it('should verify a password against its hash', async () => {
    const created = await createUser({ email: 'v@test.com', password: 'correct-horse' });
    const found = await getUserByEmail('v@test.com');
    expect(await verifyPassword('correct-horse', found.password_hash)).toBe(true);
    expect(await verifyPassword('wrong', found.password_hash)).toBe(false);
    expect(created.id).toBeTruthy();
  });

  it('should persist and decrypt groq config per user', async () => {
    const created = await createUser({ email: 'g@test.com', password: 'hunter2222' });
    const saved = await setUserGroqConfig(created.id, { apiKey: 'gsk_verysecret', model: 'openai/gpt-oss-120b' });
    expect(saved.configured).toBe(true);
    expect(saved.hasKey).toBe(true);

    const cfg = await getUserGroqConfig(created.id);
    expect(cfg.configured).toBe(true);
    expect(cfg.apiKey).toBe('gsk_verysecret');
    expect(cfg.model).toBe('openai/gpt-oss-120b');
  });

  it('should create users unverified by default and expose email_verified in rows', async () => {
    const created = await createUser({ email: 'verify@test.com', password: 'hunter2222' });
    expect(created.emailVerified).toBe(false);
    expect(fake.users[0].emailVerified).toBe(false);
    const row = await getUserByEmail('verify@test.com');
    expect(row.email_verified).toBe(false);
  });

  it('should persist and read back the verification record', async () => {
    const created = await createUser({ email: 'otp@test.com', password: 'hunter2222' });
    await saveUserVerification(created.id, { otpCodeHash: 'abc', otpAttempts: 0, otpResendAt: new Date() });
    const v = await getUserVerification('otp@test.com');
    expect(v.id).toBe(created.id);
    expect(v.otpCodeHash).toBe('abc');
    expect(v.emailVerified).toBe(false);
  });

  it('should mark a user verified and clear OTP fields', async () => {
    const created = await createUser({ email: 'done@test.com', password: 'hunter2222' });
    await saveUserVerification(created.id, { otpCodeHash: 'abc', otpAttempts: 2, otpResendAt: new Date() });
    await markEmailVerified(created.id);
    const doc = fake.users.find(u => u._id.toString() === created.id);
    expect(doc.emailVerified).toBe(true);
    expect(doc.otpCodeHash).toBeNull();
    expect(doc.otpAttempts).toBe(0);
  });

  it('should update the attempt counter', async () => {
    const created = await createUser({ email: 'attempt@test.com', password: 'hunter2222' });
    await incrementOtpAttempts(created.id, 3);
    const doc = fake.users.find(u => u._id.toString() === created.id);
    expect(doc.otpAttempts).toBe(3);
  });
});
