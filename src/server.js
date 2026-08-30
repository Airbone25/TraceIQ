import express from 'express';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from '../routes/investigation.routes.js';
import settingsRoutes from '../routes/settings.routes.js';
import { failOrphanedInvestigations } from '../database/investigation-store.js';
import { connectDb } from '../database/mongodb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = pino({ name: 'server' });
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', routes);
app.use('/api/settings', settingsRoutes);

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

if (process.env.NODE_ENV !== 'test') {
  connectDb()
    .then(() => {
      app.listen(PORT, HOST, () => {
        logger.info({ host: HOST, port: PORT }, `TraceIQ server running on ${HOST}:${PORT}`);
        failOrphanedInvestigations().catch(err => {
          logger.error({ err: err.message }, 'Startup reconciliation failed');
        });
      });
    })
    .catch(err => {
      logger.error({ err: err.message }, 'MongoDB connection failed at boot - server not started. Check MONGODB_URI.');
      process.exit(1);
    });
}

export default app;
