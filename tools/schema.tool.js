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

  async execute() {
    const schema = await getSchemaInfo();
    const tables = Object.keys(schema);
    const summary = tables.map(t => {
      const cols = schema[t].columns.map(c => `${c.name} ${c.type}${c.key ? ` [${c.key}]` : ''}`);
      return `${t}: ${cols.join(', ')}`;
    });
    return { tables, summary, raw: schema };
  },
};
