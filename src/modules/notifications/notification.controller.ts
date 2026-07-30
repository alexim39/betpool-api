import { Request, Response } from 'express';
import Notification from '../../models/notification.model';
import { logger } from '../../services/logger.service';

const VALID_TYPES = ['deposit', 'withdrawal', 'stake', 'payout', 'referral', 'kyc', 'auth', 'system'];

export class NotificationController {
  async getNotifications(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const skip = (page - 1) * limit;

      const filter: any = { user: userId };
      if (req.query.type && VALID_TYPES.includes(req.query.type as string)) {
        filter.type = req.query.type;
      }
      if (req.query.read === 'true') filter.read = true;
      else if (req.query.read === 'false') filter.read = false;
      if (req.query.from || req.query.to) {
        filter.createdAt = {};
        if (req.query.from) filter.createdAt.$gte = new Date(req.query.from as string);
        if (req.query.to) filter.createdAt.$lte = new Date(req.query.to as string);
      }

      const sortField = req.query.sortField === 'createdAt' ? 'createdAt' : 'createdAt';
      const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

      const [notifications, total] = await Promise.all([
        Notification.find(filter)
          .sort({ [sortField]: sortOrder })
          .skip(skip)
          .limit(limit)
          .lean(),
        Notification.countDocuments(filter)
      ]);

      const unreadCount = await Notification.countDocuments({ user: userId, read: false });

      res.json({
        success: true,
        data: {
          notifications,
          total,
          unreadCount,
          page,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error('Get notifications error', error);
      res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
    }
  }

  async markAsRead(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const notification = await Notification.findOneAndUpdate(
        { _id: id, user: userId },
        { read: true },
        { new: true }
      );

      if (!notification) {
        res.status(404).json({ success: false, message: 'Notification not found' });
        return;
      }

      res.json({ success: true, data: notification });
    } catch (error) {
      logger.error('Mark notification read error', error);
      res.status(500).json({ success: false, message: 'Failed to update notification' });
    }
  }

  async markAllAsRead(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      await Notification.updateMany(
        { user: userId, read: false },
        { read: true }
      );

      res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
      logger.error('Mark all read error', error);
      res.status(500).json({ success: false, message: 'Failed to mark notifications as read' });
    }
  }

  async markAsUnread(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const notification = await Notification.findOneAndUpdate(
        { _id: id, user: userId },
        { read: false },
        { new: true }
      );

      if (!notification) {
        res.status(404).json({ success: false, message: 'Notification not found' });
        return;
      }

      res.json({ success: true, data: notification });
    } catch (error) {
      logger.error('Mark notification unread error', error);
      res.status(500).json({ success: false, message: 'Failed to update notification' });
    }
  }

  async deleteNotification(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const notification = await Notification.findOneAndDelete({ _id: id, user: userId });

      if (!notification) {
        res.status(404).json({ success: false, message: 'Notification not found' });
        return;
      }

      res.json({ success: true, message: 'Notification deleted' });
    } catch (error) {
      logger.error('Delete notification error', error);
      res.status(500).json({ success: false, message: 'Failed to delete notification' });
    }
  }

  async bulkDelete(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ success: false, message: 'No notification IDs provided' });
        return;
      }
      if (ids.length > 100) {
        res.status(400).json({ success: false, message: 'Cannot delete more than 100 notifications at once' });
        return;
      }

      const result = await Notification.deleteMany({ _id: { $in: ids }, user: userId });

      res.json({ success: true, message: `${result.deletedCount} notification(s) deleted` });
    } catch (error) {
      logger.error('Bulk delete notifications error', error);
      res.status(500).json({ success: false, message: 'Failed to delete notifications' });
    }
  }
}

export const notificationController = new NotificationController();

