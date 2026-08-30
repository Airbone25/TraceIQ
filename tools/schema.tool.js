import { z } from 'zod';
import { getSchemaInfo } from '../database/queries.js';

const parameters = z.object({});

export const schemaTool = {
  name: 'get_schema',
  description: 'Returns the full database schema including tables, columns, types, keys, and indexes. Use this to understand what data is available before writing SQL queries.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  schema: parameters,

  async execute(_input, context = undefined) {
    const exec = context?.exec;
    if (!exec || typeof exec.query !== 'function' || typeof exec.rawQuery !== 'function') {
      return { success: false, error: 'No target database is bound to this investigation. Select a connection and database first.' };
    }
    const schema = await getSchemaInfo(exec);
    const tables = Object.keys(schema);
    const summary = tables.map(t => {
      const cols = schema[t].columns.map(c => `${c.name} ${c.type}${c.key ? ` [${c.key}]` : ''}`);
      return `${t}: ${cols.join(', ')}`;
    });
    return { success: true, tables, summary, raw: schema, error: null };
  },
};
