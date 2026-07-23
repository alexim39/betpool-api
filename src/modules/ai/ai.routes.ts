import { Router } from 'express';
import { chat } from './ai.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { validateOraChat } from '../../middleware/validate.middleware';

const router = Router();

router.post('/chat', authMiddleware, validateOraChat, chat);

export default router;
