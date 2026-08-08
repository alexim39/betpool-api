import mongoose from 'mongoose';
import Notification, { INotification } from '../../models/notification.model';

/**
 * Infrastructure layer — data repository.
 * All persistence access for notifications flows through this repository.
 * Every query is scoped to the owning user (tenant isolation).
 */
export interface NotificationQuery {
  userId: string;
  type?: string;
  read?: boolean;
  search?: string;
  from?: Date;
  to?: Date;
  sortField?: 'createdAt' | 'title' | 'type';
  sortOrder?: 1 | -1;
  page?: number;
  limit?: number;
}

export interface NotificationPage {
  items: Array<INotification & { _id: mongoose.Types.ObjectId }>;
  total: number;
}

export class NotificationRepository {
  private buildFilter(q: NotificationQuery): Record<string, any> {
    const filter: Record<string, any> = { user: q.userId };

    if (q.type) filter.type = q.type;
    if (q.read !== undefined) filter.read = q.read;

    if (q.search) {
      const escaped = q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { title: { $regex: escaped, $options: 'i' } },
        { message: { $regex: escaped, $options: 'i' } }
      ];
    }

    if (q.from || q.to) {
      filter.createdAt = {};
      if (q.from) filter.createdAt.$gte = q.from;
      if (q.to) filter.createdAt.$lte = q.to;
    }

    return filter;
  }

  async findPage(q: NotificationQuery): Promise<NotificationPage> {
    const page = Math.max(1, q.page || 1);
    const limit = Math.min(100, Math.max(1, q.limit || 20));
    const skip = (page - 1) * limit;

    const filter = this.buildFilter(q);
    const sortField = q.sortField || 'createdAt';
    const sortOrder = q.sortOrder === 1 ? 1 : -1;

    const [items, total] = await Promise.all([
      Notification.find(filter)
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean() as unknown as Promise<Array<INotification & { _id: mongoose.Types.ObjectId }>>,
      Notification.countDocuments(filter)
    ]);

    return { items, total };
  }

  async findByIdForUser(id: string, userId: string) {
    return Notification.findOne({ _id: id, user: userId });
  }

  async markRead(id: string, userId: string) {
    return Notification.findOneAndUpdate(
      { _id: id, user: userId },
      { read: true },
      { new: true }
    );
  }

  async markUnread(id: string, userId: string) {
    return Notification.findOneAndUpdate(
      { _id: id, user: userId },
      { read: false },
      { new: true }
    );
  }

  async markAllRead(userId: string) {
    return Notification.updateMany({ user: userId, read: false }, { read: true });
  }

  async bulkMarkRead(ids: string[], userId: string) {
    return Notification.updateMany({ _id: { $in: ids }, user: userId }, { read: true });
  }

  async bulkMarkUnread(ids: string[], userId: string) {
    return Notification.updateMany({ _id: { $in: ids }, user: userId }, { read: false });
  }

  async deleteById(id: string, userId: string) {
    return Notification.findOneAndDelete({ _id: id, user: userId });
  }

  async bulkDelete(ids: string[], userId: string) {
    return Notification.deleteMany({ _id: { $in: ids }, user: userId });
  }

  async countUnread(userId: string) {
    return Notification.countDocuments({ user: userId, read: false });
  }
}

export const notificationRepository = new NotificationRepository();
