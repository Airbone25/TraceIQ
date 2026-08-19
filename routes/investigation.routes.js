import { Router } from 'express';
import { investigate, healthCheck } from '../controllers/investigation.controller.js';

const router = Router();

router.get('/health', healthCheck);
router.post('/investigate', investigate);

export default router;
