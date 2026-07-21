import { Request, Response } from 'express';
import { chatWithOra } from '../services/ai.service';
import { ChatConversationModel } from '../models/chat-conversation.model';
import { UserModel } from '../models/user.model';
import { sendEmail } from '../services/email.service';
import { logger } from '../services/logger.service';

const ESCALATION_KEYWORDS = [
  'human agent', 'real person', 'speak to human', 'talk to human', 'real agent', 'live agent',
  'speak to a human', 'talk to a human', 'speak with a human', 'talk with a human',
  'i want to chat with a human', 'i want to speak with a human',
  'complaint', 'complain', 'escalate', 'escalation', 'manager', 'supervisor',
  'refund', 'give me my money', 'return my money', 'lost money', 'where is my money',
  'scam', 'fraud', 'cheat', 'cheating', 'stolen',
  'sue', 'legal action', 'lawyer', 'police', 'court',
  'unhappy', 'dissatisfied', 'terrible service', 'worst experience', 'bad service',
  'account blocked', 'account restricted', 'suspended unfairly',
  'threat', 'threatening'
];

function detectEscalation(text: string): string | null {
  const lower = text.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function sendEscalationNotification(userId: string, reason: string, messageContent: string) {
  try {
    const user = await UserModel.findById(userId).select('fullName phone email');
    if (!user) return;

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@betpool.tech';
    const userName = user.fullName || user.phone || 'Unknown';
    const subject = `[ORA Escalation] ${userName} — "${reason}"`;
    const text = `User ${userName} (${user.phone}, ${user.email || 'no email'}) triggered an escalation:\n\nKeyword: "${reason}"\nMessage: "${messageContent}"\n\nPlease review in the admin panel.`;

    logger.info('ORA escalation detected', { userId, reason, userName });

    try {
      const html = `<p><strong>User:</strong> ${userName}</p>
<p><strong>Phone:</strong> ${user.phone || 'N/A'}</p>
<p><strong>Email:</strong> ${user.email || 'N/A'}</p>
<p><strong>Keyword:</strong> ${reason}</p>
<p><strong>Message:</strong> ${messageContent}</p>
<p><a href="${process.env.ADMIN_URL || 'http://localhost:4200'}/admin/ora-chat" style="display:inline-block;padding:10px 24px;background:#00E676;color:#0A1428;text-decoration:none;border-radius:8px;font-weight:700;margin-top:16px">View in Admin</a></p>`;
      await sendEmail(adminEmail, subject, html);
    } catch (e) {
      logger.error('Failed to send escalation email', e);
    }
  } catch (e) {
    logger.error('Escalation notification error', e);
  }
}

export const chat = async (req: Request, res: Response) => {
  try {
    const { messages } = req.body;
    const userId = (req as any).user?.userId;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, message: 'Messages array is required' });
    }

    const userMessage = messages[messages.length - 1];

    const result = await chatWithOra(messages, userId);

    if (userId) {
      try {
        let conversation = await ChatConversationModel.findOne({ user: userId, status: { $ne: 'resolved' } });

        if (!conversation) {
          conversation = new ChatConversationModel({ user: userId, messages: [] });
        }

        conversation.messages.push({
          role: userMessage.role,
          content: userMessage.content,
          timestamp: new Date()
        });

        conversation.messages.push({
          role: 'assistant',
          content: result.content,
          timestamp: new Date()
        });

        const keyword = detectEscalation(userMessage.content);
        if (keyword && conversation.status === 'active') {
          conversation.status = 'escalated';
          conversation.escalatedAt = new Date();
          conversation.escalationReason = keyword;
          conversation.escalatedNotified = false;

          sendEscalationNotification(userId, keyword, userMessage.content);
        }

        await conversation.save();
      } catch (dbError) {
        logger.error('Failed to persist chat message', dbError);
      }
    }

    return res.json({ success: true, data: { content: result.content, usage: result.usage } });
  } catch (error) {
    logger.error('AI chat error', error);
    return res.status(500).json({ success: false, message: 'Failed to process chat' });
  }
};
