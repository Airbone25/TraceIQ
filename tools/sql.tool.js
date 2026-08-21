import { z } from 'zod';
import { query } from '../database/mysql.js';
import { validateSql } from '../security/sql-validator.js';
import env from '../config/env.js';

const defaultExec = { query };

const parameters = z.object({
  sql: z.string().describe('The SQL query to execute. Must be a SELECT, SHOW, DESCRIBE, or EXPLAIN statement.'),
  params: z.array(z.union([z.string(), z.number()])).optional().describe('Parameterized query values.'),
});

export const sqlTool = {
  name: 'execute_sql',
  description: 'Executes a read-only SQL query against the database. Only SELECT, SHOW, DESCRIBE, and EXPLAIN statements are allowed. All other statements (INSERT, UPDATE, DELETE, etc.) are blocked.',
  parameters: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'The SQL query to execute. Must be a SELECT, SHOW, DESCRIBE, or EXPLAIN statement.',
      },
      params: {
        type: 'array',
        items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        description: 'Optional parameterized query values to prevent SQL injection.',
      },
    },
    required: ['sql'],
  },
  schema: parameters,

  async execute({ sql, params = [] }, context = undefined) {
    const validation = validateSql(sql, { maxRows: env.MAX_QUERY_ROWS });
    if (!validation.valid) {
      return {
        success: false,
        error: `SQL validation failed: ${validation.errors.join('; ')}`,
        query: sql,
      };
    }

    const stripped = validation.sanitized.replace(/;\s*$/, '');
    const hasLimit = /\bLIMIT\s+\d+/i.test(stripped);
    const limitedSql = hasLimit ? stripped : stripped + ` LIMIT ${env.MAX_QUERY_ROWS}`;

    try {
      const start = Date.now();
      const rows = await (context?.exec ?? defaultExec).query(limitedSql, params);
      const duration = Date.now() - start;
      return {
        success: true,
        rows,
        rowCount: rows.length,
        duration,
        truncated: rows.length >= env.MAX_QUERY_ROWS,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        query: limitedSql,
      };
    }
  },
};
