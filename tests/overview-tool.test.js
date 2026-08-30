import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery, mockRawQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockRawQuery: vi.fn(),
}));

import { overviewTool } from '../tools/overview.tool.js';

const execContext = { exec: { query: mockQuery, rawQuery: mockRawQuery } };

function routeQuery(handlers) {
  return (sql) => {
    const s = String(sql);
    if (s.includes('INFORMATION_SCHEMA')) return handlers.infoColumns ? handlers.infoColumns() : Promise.resolve([]);
    const tableMatch = s.match(/FROM `([^`]+)`/);
    const table = tableMatch ? tableMatch[1] : '';
    if (/^SELECT COUNT/i.test(s.trim())) {
      return handlers.count ? handlers.count(table) : Promise.resolve([{ count: 0 }]);
    }
    return handlers.minMax ? handlers.minMax(table) : Promise.resolve([{}]);
  };
}

describe('Overview Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return row counts for every table', async () => {
    mockRawQuery.mockResolvedValue([{ t: 'orders' }, { t: 'customers' }]);
    mockQuery.mockImplementation(routeQuery({
      count: (table) => Promise.resolve([{ count: table === 'orders' ? 120 : 7 }]),
    }));

    const result = await overviewTool.execute({}, execContext);

    expect(result.success).toBe(true);
    expect(result.tables).toEqual([
      { name: 'orders', rowCount: 120 },
      { name: 'customers', rowCount: 7 },
    ]);
    expect(result.dateRanges).toEqual([]);
  });

  it('should detect date column ranges grouped per table', async () => {
    mockRawQuery.mockResolvedValue([{ t: 'orders' }]);
    mockQuery.mockImplementation(routeQuery({
      count: () => Promise.resolve([{ count: 50 }]),
      infoColumns: () => Promise.resolve([
        { tableName: 'orders', columnName: 'created_at' },
        { tableName: 'orders', columnName: 'shipped_at' },
      ]),
      minMax: () => Promise.resolve([{ min_created_at: '2026-01-01', max_created_at: '2026-08-22', min_shipped_at: null, max_shipped_at: '2026-08-01' }]),
    }));

    const result = await overviewTool.execute({}, execContext);

    expect(result.success).toBe(true);
    expect(result.dateRanges).toEqual([
      { table: 'orders', column: 'created_at', min: '2026-01-01', max: '2026-08-22' },
      { table: 'orders', column: 'shipped_at', min: null, max: '2026-08-01' },
    ]);
  });

  it('should skip tables whose date scan fails but keep the rest', async () => {
    mockRawQuery.mockResolvedValue([{ t: 'good' }, { t: 'broken' }]);
    mockQuery.mockImplementation(routeQuery({
      count: () => Promise.resolve([{ count: 5 }]),
      infoColumns: () => Promise.resolve([
        { tableName: 'good', columnName: 'created_at' },
        { tableName: 'broken', columnName: 'created_at' },
      ]),
      minMax: (table) => table === 'broken'
        ? Promise.reject(new Error('table exploded'))
        : Promise.resolve([{ min_created_at: '2026-02-02', max_created_at: '2026-03-03' }]),
    }));

    const result = await overviewTool.execute({}, execContext);

    expect(result.success).toBe(true);
    expect(result.dateRanges).toEqual([
      { table: 'good', column: 'created_at', min: '2026-02-02', max: '2026-03-03' },
    ]);
  });

  it('should report success:false when tables cannot be listed', async () => {
    mockRawQuery.mockRejectedValue(new Error('no database selected'));

    const result = await overviewTool.execute({}, execContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('no database selected');
  });

  it('should reject execution when no target database is bound', async () => {
    const result = await overviewTool.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toContain('No target database is bound');
  });
});
