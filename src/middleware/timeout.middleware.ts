import { Request, Response, NextFunction } from 'express';

export function requestTimeout(ms: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          message: `Request timed out after ${ms}ms`,
        });
      }
    }, ms);
    res.on('finish', () => clearTimeout(timer));
    next();
  };
}
