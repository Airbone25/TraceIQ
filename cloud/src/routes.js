import { Router } from 'express';
import { requireAuth } from './middleware/auth.js';
import {
  registerHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  deleteAccountHandler,
} from './controllers/auth.controller.js';
import {
  getGroqHandler,
  updateGroqHandler,
  verifyGroqHandler,
} from './controllers/groq.controller.js';
import {
  listConnectionsHandler,
  createConnectionHandler,
  deleteConnectionHandler,
  touchConnectionHandler,
  getConnectionCredentialsHandler,
} from './controllers/connection.controller.js';
import {
  createThreadHandler,
  listThreadsHandler,
  getThreadDetailHandler,
  addFollowUpMessageHandler,
  deleteThreadHandler,
  getThreadContextHandler,
} from './controllers/thread.controller.js';
import {
  listAllInvestigationsHandler,
  getInvestigationByIdHandler,
  addStepHandler,
  updateInvestigationHandler,
} from './controllers/investigation.controller.js';

export const router = Router();

// Health
router.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Auth (register/login are public; the rest require a JWT)
router.post('/auth/register', registerHandler);
router.post('/auth/login', loginHandler);
router.post('/auth/logout', logoutHandler);
router.get('/auth/me', requireAuth, meHandler);
router.delete('/account', requireAuth, deleteAccountHandler);

// Groq / block keys
router.get('/keys', requireAuth, getGroqHandler);
router.put('/keys', requireAuth, updateGroqHandler);
router.post('/keys/verify', requireAuth, verifyGroqHandler);

// Saved connections
router.get('/connections', requireAuth, listConnectionsHandler);
router.post('/connections', requireAuth, createConnectionHandler);
router.post('/connections/:id/touch', requireAuth, touchConnectionHandler);
router.get('/connections/:id/credentials', requireAuth, getConnectionCredentialsHandler);
router.delete('/connections/:id', requireAuth, deleteConnectionHandler);

// Threads, messages, investigations
router.get('/threads', requireAuth, listThreadsHandler);
router.post('/threads', requireAuth, createThreadHandler);
router.get('/threads/:id', requireAuth, getThreadDetailHandler);
router.get('/threads/:id/context', requireAuth, getThreadContextHandler);
router.post('/threads/:id/messages', requireAuth, addFollowUpMessageHandler);
router.delete('/threads/:id', requireAuth, deleteThreadHandler);

router.get('/investigations', requireAuth, listAllInvestigationsHandler);
router.get('/investigations/:id', requireAuth, getInvestigationByIdHandler);
router.post('/investigations/:id/steps', requireAuth, addStepHandler);
router.patch('/investigations/:id', requireAuth, updateInvestigationHandler);
