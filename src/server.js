import express from 'express';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from '../routes/investigation.routes.js';
import { failOrphanedInvestigations } from '../database/investigation-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = pino({ name: 'server' });
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', routes);

const PORT = process.env.PORT || 3001;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info({ port: PORT }, `TraceIQ server running on port ${PORT}`);
    failOrphanedInvestigations().catch(err => {
      logger.error({ err: err.message }, 'Startup reconciliation failed');
    });
  });
}

export default app;
