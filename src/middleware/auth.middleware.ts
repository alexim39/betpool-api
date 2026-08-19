import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/user.model';

const JWT_SECRET = (() => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
  return process.env.JWT_SECRET;
})();

export interface AuthRequest extends Request {
  user?: { userId: string; role?: string; tokenVersion?: number };
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role?: string; tokenVersion?: number };
    // Verify tokenVersion and user status
    const user = await UserModel.findById(decoded.userId).select('tokenVersion isActive isSuspended lastActiveAt').lean();
    if (!user || !user.isActive || user.isSuspended) {
      return res.status(401).json({ success: false, message: 'Account suspended or inactive' });
    }
    if (decoded.tokenVersion !== undefined && decoded.tokenVersion < user.tokenVersion) {
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    }
    req.user = { userId: decoded.userId, role: decoded.role, tokenVersion: decoded.tokenVersion };
    // Track real activity (throttled to one write per user per 5 minutes)
    const now = Date.now();
    if (!user.lastActiveAt || now - user.lastActiveAt.getTime() > 5 * 60 * 1000) {
      UserModel.updateOne(
        { _id: decoded.userId, $or: [{ lastActiveAt: null }, { lastActiveAt: { $lt: new Date(now - 5 * 60 * 1000) } }] },
        { $set: { lastActiveAt: new Date(now) } }
      ).catch(() => { /* non-fatal tracking write */ });
    }
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

export const optionalAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; tokenVersion?: number };
    req.user = { userId: decoded.userId, tokenVersion: decoded.tokenVersion };
  } catch {
    // Ignore invalid tokens for optional auth
  }
  next();
};
