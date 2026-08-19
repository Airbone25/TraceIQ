import express from 'express';
import pino from 'pino';
import routes from '../routes/investigation.routes.js';

const logger = pino({ name: 'server' });
const app = express();

app.use(express.json());
app.use('/api', routes);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  logger.info({ port: PORT }, `TraceIQ server running on port ${PORT}`);
});

export default app;
