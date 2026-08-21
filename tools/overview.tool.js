import { z } from 'zod';
import { getTableRowCounts, getDateColumnRanges } from '../database/queries.js';

const parameters = {
  type: 'object',
  properties: {},
  required: [],
};

const overviewSchema = z.object({}).strict();

export const overviewTool = {
  name: 'get_overview',
  description: 'Returns a high-level overview of the database: every table with its exact row count, plus the minimum and maximum values of all date/datetime/timestamp columns. Use this to understand what data exists and which time windows are available before writing SQL.',
  parameters,
  schema: overviewSchema,

  async execute(_input, context = undefined) {
    try {
      const start = Date.now();
      const exec = context?.exec;
      const [counts, dateRanges] = await Promise.all([
        getTableRowCounts(exec),
        getDateColumnRanges(exec).catch(() => []),
      ]);
      return {
        success: true,
        tables: Object.entries(counts).map(([name, rowCount]) => ({ name, rowCount })),
        dateRanges,
        duration: Date.now() - start,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};
