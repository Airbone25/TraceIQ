import { Router } from 'express';
import { requireAuth } from './middleware/auth.js';
import {
  registerHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  updateAccountHandler,
  deleteAccountHandler,
} from './controllers/auth.controller.js';
import {
  getGroqHandler,
  updateGroqHandler,
  verifyGroqHandler,
  getActiveGroqKeyHandler,
} from './controllers/groq.controller.js';
import {
  listConnectionsHandler,
  createConnectionHandler,
  getConnectionByIdHandler,
  deleteConnectionHandler,
  touchConnectionHandler,
  getConnectionCredentialsHandler,
} from './controllers/connection.controller.js';
import {
  createThreadHandler,
  listThreadsHandler,
  getThreadDetailHandler,
  addFollowUpMessageHandler,
  addAssistantMessageHandler,
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
router.patch('/account', requireAuth, updateAccountHandler);

// Groq / block keys
router.get('/keys', requireAuth, getGroqHandler);
router.put('/keys', requireAuth, updateGroqHandler);
router.post('/keys/verify', requireAuth, verifyGroqHandler);
router.get('/keys/active', requireAuth, getActiveGroqKeyHandler);

// Saved connections
router.get('/connections', requireAuth, listConnectionsHandler);
router.post('/connections', requireAuth, createConnectionHandler);
router.get('/connections/:id', requireAuth, getConnectionByIdHandler);
router.post('/connections/:id/touch', requireAuth, touchConnectionHandler);
router.get('/connections/:id/credentials', requireAuth, getConnectionCredentialsHandler);
router.delete('/connections/:id', requireAuth, deleteConnectionHandler);

// Threads, messages, investigations
router.get('/threads', requireAuth, listThreadsHandler);
router.post('/threads', requireAuth, createThreadHandler);
router.get('/threads/:id', requireAuth, getThreadDetailHandler);
router.get('/threads/:id/context', requireAuth, getThreadContextHandler);
router.post('/threads/:id/messages', requireAuth, addFollowUpMessageHandler);
router.post('/threads/:id/messages/assistant', requireAuth, addAssistantMessageHandler);
router.delete('/threads/:id', requireAuth, deleteThreadHandler);

router.get('/investigations', requireAuth, listAllInvestigationsHandler);
router.get('/investigations/:id', requireAuth, getInvestigationByIdHandler);
router.post('/investigations/:id/steps', requireAuth, addStepHandler);
router.patch('/investigations/:id', requireAuth, updateInvestigationHandler);
