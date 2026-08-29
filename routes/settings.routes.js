import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getSettingsHandler,
  getGroqHandler,
  updateGroqHandler,
  verifyGroqHandler,
  updateAccountHandler,
  deleteAccountHandler,
} from '../controllers/settings.controller.js';

const router = Router();

// All settings routes require auth
router.use(requireAuth);

router.get('/', getSettingsHandler);
router.get('/groq', getGroqHandler);
router.put('/groq', updateGroqHandler);
router.post('/groq/verify', verifyGroqHandler);
router.put('/account', updateAccountHandler);
router.delete('/account', deleteAccountHandler);

export default router;
