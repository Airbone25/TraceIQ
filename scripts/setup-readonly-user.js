import 'dotenv/config';
import mysql from 'mysql2/promise';
import pino from 'pino';

const logger = pino({ name: 'setup-readonly-user' });

const rootConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
};

const dbName = process.env.MYSQL_DATABASE || 'traceiq';
const readonlyUser = process.env.MYSQL_READONLY_USER || 'traceiq_readonly';
const readonlyPassword = process.env.MYSQL_READONLY_PASSWORD || 'traceiq_readonly_pw';

async function setupReadonlyUser() {
  let conn;
  try {
    conn = await mysql.createConnection(rootConfig);
    logger.info('Connected to MySQL as admin');

    await conn.execute(
      `CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?`,
      [readonlyUser, readonlyPassword]
    );
    logger.info({ user: readonlyUser }, 'Read-only user created/verified');

    await conn.execute(
      `GRANT SELECT ON \`${dbName}\`.* TO ?@'%'`,
      [readonlyUser]
    );
    logger.info({ user: readonlyUser, database: dbName }, 'SELECT privileges granted');

    await conn.execute('FLUSH PRIVILEGES');
    logger.info('Privileges flushed');

    logger.info({ user: readonlyUser, database: dbName }, 'Setup complete');
    logger.info('Update your .env with:');
    logger.info(`  MYSQL_USER=${readonlyUser}`);
    logger.info(`  MYSQL_PASSWORD=${readonlyPassword}`);
  } catch (err) {
    logger.error({ err: err.message }, 'Setup failed');
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

setupReadonlyUser();
