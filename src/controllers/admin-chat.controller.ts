import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ChatConversationModel } from '../models/chat-conversation.model';
import { UserModel } from '../models/user.model';

export class AdminChatController {
  async listSessions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const status = req.query.status as string;
      const search = req.query.search as string;

      const filter: any = {};

      if (status && ['active', 'escalated', 'resolved'].includes(status)) {
        filter.status = status;
      }

      if (search) {
        const users = await UserModel.find({
          $or: [
            { phone: { $regex: search, $options: 'i' } },
            { fullName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } }
          ]
        }).select('_id');

        const userIds = users.map(u => u._id);
        if (userIds.length > 0) {
          filter.user = { $in: userIds };
        } else {
          res.json({ success: true, data: { sessions: [], total: 0, page, pages: 0 } });
          return;
        }
      }

      const [sessions, total] = await Promise.all([
        ChatConversationModel.find(filter)
          .sort({ updatedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .populate('user', 'fullName phone email photo'),
        ChatConversationModel.countDocuments(filter)
      ]);

      const sessionsWithMeta = sessions.map(s => ({
        _id: s._id,
        user: s.user,
        status: s.status,
        messageCount: s.messages.length,
        lastMessage: s.messages.length > 0 ? s.messages[s.messages.length - 1].content : '',
        lastActivity: s.updatedAt,
        escalatedAt: s.escalatedAt,
        escalationReason: s.escalationReason,
        escalatedNotified: s.escalatedNotified,
        createdAt: s.createdAt
      }));

      res.json({
        success: true,
        data: {
          sessions: sessionsWithMeta,
          total,
          page,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Admin list chat sessions error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch chat sessions' });
    }
  }

  async getSession(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const session = await ChatConversationModel.findById(id)
        .populate('user', 'fullName phone email photo');

      if (!session) {
        res.status(404).json({ success: false, message: 'Chat session not found' });
        return;
      }

      res.json({ success: true, data: session });
    } catch (error) {
      console.error('Admin get chat session error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch chat session' });
    }
  }

  async resolveSession(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const session = await ChatConversationModel.findByIdAndUpdate(
        id,
        { status: 'resolved' },
        { new: true }
      );

      if (!session) {
        res.status(404).json({ success: false, message: 'Chat session not found' });
        return;
      }

      res.json({ success: true, data: session });
    } catch (error) {
      console.error('Admin resolve chat session error:', error);
      res.status(500).json({ success: false, message: 'Failed to resolve chat session' });
    }
  }

  async getStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const [total, active, escalated, resolved] = await Promise.all([
        ChatConversationModel.countDocuments(),
        ChatConversationModel.countDocuments({ status: 'active' }),
        ChatConversationModel.countDocuments({ status: 'escalated' }),
        ChatConversationModel.countDocuments({ status: 'resolved' })
      ]);

      res.json({
        success: true,
        data: { total, active, escalated, resolved }
      });
    } catch (error) {
      console.error('Admin chat stats error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch chat stats' });
    }
  }
}

export const adminChatController = new AdminChatController();
