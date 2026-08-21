import { Router } from 'express';
import { investigate, healthCheck, getInvestigationById, listAllInvestigations } from '../controllers/investigation.controller.js';
import { createThreadHandler, addFollowUpMessage, listThreadsHandler, getThreadDetail } from '../controllers/threads.controller.js';

const router = Router();

router.get('/health', healthCheck);
router.post('/investigate', investigate);
router.get('/investigations', listAllInvestigations);
router.get('/investigate/:id', getInvestigationById);

router.post('/threads', createThreadHandler);
router.get('/threads', listThreadsHandler);
router.get('/threads/:id', getThreadDetail);
router.post('/threads/:id/messages', addFollowUpMessage);

export default router;
