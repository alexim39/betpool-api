import { Router } from 'express';
import { adminChatController } from './admin-chat.controller';

const router = Router();

router.get('/stats', adminChatController.getStats);
router.get('/sessions', adminChatController.listSessions);
router.get('/sessions/:id', adminChatController.getSession);
router.put('/sessions/:id/resolve', adminChatController.resolveSession);

export default router;
