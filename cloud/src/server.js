import express from 'express';
import cors from 'cors';
import env from './env.js';
import { connectDb, closeDb } from './db.js';
import { router } from './routes.js';
import { logger } from './utils/logger.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api', router);

// 404 for unknown API routes
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler (surfaces unhandled async rejections in handlers)
app.use((err, _req, res, _next) => {
  logger.error({ err: err && err.message }, 'Unhandled request error');
  if (res.headersSent) return;
  return res.status(500).json({ error: 'Internal server error', detail: err && err.message });
});

async function main() {
  await connectDb();
  logger.info('MongoDB connected');
  const server = app.listen(env.PORT, () => {
    logger.info(`TraceIQ cloud API listening on :${env.PORT}`);
  });

  const shutdown = async () => {
    logger.info('Shutting down cloud API');
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err: err && err.message }, 'Cloud API failed to start');
  process.exit(1);
});
