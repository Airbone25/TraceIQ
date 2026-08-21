import { query, rawQuery } from './mysql.js';

const defaultExec = { query, rawQuery };

export async function getSchemaInfo(exec = defaultExec) {
  const tables = await exec.rawQuery('SHOW TABLES');
  const tableNames = tables.map(row => Object.values(row)[0]);

  const schema = {};
  await Promise.all(tableNames.map(async (table) => {
    const [columns, indexes] = await Promise.all([
      rawQuery(`SHOW COLUMNS FROM \`${table}\``),
      rawQuery(`SHOW INDEX FROM \`${table}\``),
    ]);
    schema[table] = {
      columns: columns.map(c => ({
        name: c.Field,
        type: c.Type,
        nullable: c.Null === 'YES',
        key: c.Key,
        default: c.Default,
      })),
      indexes: indexes.map(i => ({
        name: i.Key_name,
        column: i.Column_name,
        unique: !i.Non_unique,
      })),
    };
  }));
  return schema;
}

export async function getTableRowCounts(exec = defaultExec) {
  const tables = await exec.rawQuery('SHOW TABLES');
  const tableNames = tables.map(row => Object.values(row)[0]);
  const counts = {};
  for (const table of tableNames) {
    const [row] = await exec.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
    counts[table] = row.count;
  }
  return counts;
}

export async function getDateColumnRanges(exec = defaultExec) {
  const columns = await exec.query(`
    SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND DATA_TYPE IN ('date', 'datetime', 'timestamp')
    ORDER BY TABLE_NAME, COLUMN_NAME
  `);

  const byTable = {};
  for (const { tableName, columnName } of columns) {
    if (!byTable[tableName]) byTable[tableName] = [];
    byTable[tableName].push(columnName);
  }

  const ranges = [];
  for (const [table, tableColumns] of Object.entries(byTable)) {
    try {
      const selects = tableColumns
        .map(col => `MIN(\`${col}\`) AS \`min_${col}\`, MAX(\`${col}\`) AS \`max_${col}\``)
        .join(', ');
      const [row] = await exec.query(`SELECT ${selects} FROM \`${table}\``);
      for (const col of tableColumns) {
        if (row[`min_${col}`] != null || row[`max_${col}`] != null) {
          ranges.push({ table, column: col, min: row[`min_${col}`], max: row[`max_${col}`] });
        }
      }
    } catch {
      // Skip unreadable tables; a partial overview beats a failed one.
    }
  }
  return ranges;
}
