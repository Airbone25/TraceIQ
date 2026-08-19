import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../database/mysql.js';

describe('Health Endpoint', () => {
  let baseUrl;

  beforeAll(async () => {
    await getPool().getConnection();
    baseUrl = 'http://localhost:3000';
  });

  it('should respond to health check', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.database).toBe('connected');
    expect(data.timestamp).toBeDefined();
  });

  it('should reject missing question on investigate', async () => {
    const res = await fetch(`${baseUrl}/api/investigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  afterAll(async () => {
    await closePool();
  });
});
