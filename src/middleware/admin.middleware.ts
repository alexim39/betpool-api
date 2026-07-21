import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';

export const adminMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (req.user.role === 'admin') {
      return next();
    }

    return res.status(403).json({ success: false, message: 'Admin access required' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Admin check failed' });
  }
};
