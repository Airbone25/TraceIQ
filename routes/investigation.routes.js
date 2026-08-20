import { Router } from 'express';
import { investigate, healthCheck, getInvestigationById, listAllInvestigations } from '../controllers/investigation.controller.js';

const router = Router();

router.get('/health', healthCheck);
router.post('/investigate', investigate);
router.get('/investigations', listAllInvestigations);
router.get('/investigate/:id', getInvestigationById);

export default router;
