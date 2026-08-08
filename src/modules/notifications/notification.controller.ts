import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { notificationRepository } from './notification.repository';
import { logger } from '../../services/logger.service';

const VALID_TYPES = ['deposit', 'withdrawal', 'stake', 'payout', 'referral', 'kyc', 'auth', 'system'];
const SORT_FIELDS = ['createdAt', 'title', 'type'];
const MAX_BULK = 100;

function getUserId(req: Request): string | null {
  return (req as any).user?.userId || (req as any).user?._id || null;
}

function parseObjectIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  if (ids.length > MAX_BULK) return null;
  if (!ids.every((id) => typeof id === 'string' && mongoose.isValidObjectId(id))) return null;
  return ids as string[];
}

export class NotificationController {
  async getNotifications(req: Request, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(MAX_BULK, Math.max(1, parseInt(req.query.limit as string, 10) || 20));

      const type = req.query.type as string;
      const readParam = req.query.read as string;
      const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';

      let from: Date | undefined;
      let to: Date | undefined;
      if (req.query.from || req.query.to) {
        if (req.query.from) {
          const parsed = new Date(req.query.from as string);
          if (!isNaN(parsed.getTime())) from = parsed;
        }
        if (req.query.to) {
          const parsed = new Date(req.query.to as string);
          if (!isNaN(parsed.getTime())) to = parsed;
        }
      }

      const sortField = SORT_FIELDS.includes(req.query.sortField as string) ? (req.query.sortField as 'createdAt' | 'title' | 'type') : 'createdAt';
      const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

      const [{ items, total }, unreadCount] = await Promise.all([
        notificationRepository.findPage({
          userId,
          type: type && VALID_TYPES.includes(type) ? type : undefined,
          read: readParam === 'true' ? true : readParam === 'false' ? false : undefined,
          search: search || undefined,
          from,
          to,
          sortField,
          sortOrder,
          page,
          limit
        }),
        notificationRepository.countUnread(userId)
      ]);

      res.json({
        success: true,
        data: {
          notifications: items,
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
      const userId = getUserId(req);
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(400).json({ success: false, message: 'Invalid notification ID' });
        return;
      }

      const notification = await notificationRepository.markRead(req.params.id, userId);
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

  async markAsUnread(req: Request, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(400).json({ success: false, message: 'Invalid notification ID' });
        return;
      }

      const notification = await notificationRepository.markUnread(req.params.id, userId);
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

  async markAllAsRead(req: Request, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      await notificationRepository.markAllRead(userId);
      res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
      logger.error('Mark all read error', error);
      res.status(500).json({ success: false, message: 'Failed to mark notifications as read' });
    }
  }

  async bulkMarkAsRead(req: Request, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const ids = parseObjectIds(req.body?.ids);
      if (!ids) {
        res.status(400).json({ success: false, message: 'A valid array of up to 100 notification IDs is required' });
        return;
      }

      const result = await notificationRepository.bulkMarkRead(ids, userId);
      res.json({ success: true, message: `${result.modifiedCount} notification(s) marked as read` });
    } catch (error) {
      logger.error('Bulk mark read error', error);
      res.status(500).json({ success: false, message: 'Failed to update notifications' });
    }
  }

  async bulkMarkAsUnread(req: Request, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const ids = parseObjectIds(req.body?.ids);
      if (!ids) {
        res.status(400).json({ success: false, message: 'A valid array of up to 100 notification IDs is required' });
        return;
      }

      const result = await notificationRepository.bulkMarkUnread(ids, userId);
      res.json({ success: true, message: `${result.modifiedCount} notification(s) marked as unread` });
    } catch (error) {
      logger.error('Bulk mark unread error', error);
      res.status(500).json({ success: false, message: 'Failed to update notifications' });
    }
  }

  async deleteNotification(req: Request, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(400).json({ success: false, message: 'Invalid notification ID' });
        return;
      }

      const notification = await notificationRepository.deleteById(req.params.id, userId);
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
      const userId = getUserId(req);
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const ids = parseObjectIds(req.body?.ids);
      if (!ids) {
        res.status(400).json({ success: false, message: 'A valid array of up to 100 notification IDs is required' });
        return;
      }

      const result = await notificationRepository.bulkDelete(ids, userId);
      res.json({ success: true, message: `${result.deletedCount} notification(s) deleted` });
    } catch (error) {
      logger.error('Bulk delete notifications error', error);
      res.status(500).json({ success: false, message: 'Failed to delete notifications' });
    }
  }
}

export const notificationController = new NotificationController();
