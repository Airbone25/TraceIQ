import { Router } from 'express';
import { investigate, healthCheck, getInvestigationById, listAllInvestigations } from '../controllers/investigation.controller.js';
import { createThreadHandler, addFollowUpMessage, listThreadsHandler, getThreadDetail, deleteThreadHandler } from '../controllers/threads.controller.js';
import { createConnectionHandler, listConnectionsHandler, deleteConnectionHandler, listDatabasesHandler, healthHandler, schemaHandler, provisionSampleHandler } from '../controllers/connections.controller.js';
import { registerHandler, loginHandler, logoutHandler, meHandler } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/health', healthCheck);
router.post('/auth/register', registerHandler);
router.post('/auth/login', loginHandler);
router.post('/auth/logout', logoutHandler);
router.get('/auth/me', requireAuth, meHandler);

router.use(requireAuth);

router.post('/investigate', investigate);
router.get('/investigations', listAllInvestigations);
router.get('/investigate/:id', getInvestigationById);

router.post('/connections', createConnectionHandler);
router.get('/connections', listConnectionsHandler);
router.get('/connections/health', healthHandler);
router.delete('/connections/:id', deleteConnectionHandler);
router.get('/connections/:id/databases', listDatabasesHandler);
router.get('/connections/:id/schema', schemaHandler);
router.post('/connections/:id/sample-dataset', provisionSampleHandler);

router.post('/threads', createThreadHandler);
router.get('/threads', listThreadsHandler);
router.get('/threads/:id', getThreadDetail);
router.post('/threads/:id/messages', addFollowUpMessage);
router.delete('/threads/:id', deleteThreadHandler);

export default router;
