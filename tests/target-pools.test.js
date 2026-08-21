import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreatePool } = vi.hoisted(() => ({ mockCreatePool: vi.fn() }));

vi.mock('mysql2/promise', () => ({
  default: { createPool: mockCreatePool },
}));

vi.mock('../config/env.js', () => ({
  default: { MAX_QUERY_TIMEOUT_MS: 30000 },
}));

import {
  getTargetPool,
  closeTargetPools,
  makeExecutor,
  __resetTargetPoolsForTests,
} from '../database/target-pools.js';

function fakePool() {
  return {
    execute: vi.fn().mockResolvedValue([[{ id: 1 }]]),
    query: vi.fn().mockResolvedValue([[{ t: 'x' }]]),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

const baseConfig = {
  connectionId: 'conn-1',
  database: 'sales_db',
  host: 'localhost',
  port: 3306,
  user: 'reader',
  password: 'pw',
};

describe('Target Pools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePool.mockImplementation(fakePool);
    __resetTargetPoolsForTests();
  });

  it('should cache one pool per connection+database pair', () => {
    const first = getTargetPool(baseConfig);
    const second = getTargetPool(baseConfig);
    expect(mockCreatePool).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    getTargetPool({ ...baseConfig, database: 'other_db' });
    expect(mockCreatePool).toHaveBeenCalledTimes(2);
  });

  it('should pass database and credentials to mysql2 createPool', () => {
    getTargetPool(baseConfig);
    expect(mockCreatePool).toHaveBeenCalledWith(expect.objectContaining({
      host: 'localhost',
      port: 3306,
      user: 'reader',
      password: 'pw',
      database: 'sales_db',
      connectionLimit: 5,
    }));
  });

  it('should close only pools belonging to the given connection', async () => {
    const p1 = getTargetPool(baseConfig);
    const p2 = getTargetPool({ ...baseConfig, connectionId: 'conn-2' });

    await closeTargetPools('conn-1');

    expect(p1.end).toHaveBeenCalled();
    expect(p2.end).not.toHaveBeenCalled();
  });

  it('should expose an executor that routes through the pool', async () => {
    const pool = getTargetPool(baseConfig);
    const exec = makeExecutor(pool);

    const rows = await exec.query('SELECT * FROM orders WHERE id = ?', [7]);
    expect(pool.execute).toHaveBeenCalledWith(
      expect.objectContaining({ sql: 'SELECT * FROM orders WHERE id = ?' }),
      [7]
    );
    expect(rows).toEqual([{ id: 1 }]);

    await exec.rawQuery('SHOW TABLES');
    expect(pool.query).toHaveBeenCalledWith('SHOW TABLES');
  });
});
