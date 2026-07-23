import { Router } from 'express';
import { notificationController } from './notification.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();

router.get('/', authMiddleware, notificationController.getNotifications);
router.put('/read-all', authMiddleware, notificationController.markAllAsRead);
router.put('/:id/read', authMiddleware, notificationController.markAsRead);
router.put('/:id/unread', authMiddleware, notificationController.markAsUnread);
router.delete('/:id', authMiddleware, notificationController.deleteNotification);

export default router;
