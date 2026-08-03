import { Request, Response } from 'express';
import { aiDigestService } from './ai-digest.service';
import { verifyDigestToken } from './digest-utils';
import { UserModel } from '../../models/user.model';

export class DigestController {
  async runDigest(req: Request, res: Response): Promise<void> {
    try {
      const dryRunTo = typeof (req.body as any)?.dryRunTo === 'string' ? (req.body as any).dryRunTo : undefined;
      const report = await aiDigestService.runDailyDigest({ dryRunTo });
      res.json({ success: true, data: report });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Digest run failed' });
    }
  }

  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      res.json({ success: true, data: aiDigestService.getStatus() });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async unsubscribe(req: Request, res: Response): Promise<void> {
    try {
      const { userId, token } = req.params as { userId: string; token: string };
      if (!verifyDigestToken(userId, token)) {
        res.status(400).type('html').send(`<html><body style="background:#0A1428;color:#fff;font-family:Segoe UI,Roboto,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-size:18px">Invalid link</h1><p style="font-size:13px;color:rgba(255,255,255,0.6)">This unsubscribe link is invalid or expired.</p></div></body></html>`);
        return;
      }
      await UserModel.findByIdAndUpdate(userId, { $set: { digestOptOut: true } });
      res.type('html').send(`<html><body style="background:#0A1428;color:#fff;font-family:Segoe UI,Roboto,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:40px;margin-bottom:12px">✅</div><h1 style="font-size:18px;font-weight:600">You're unsubscribed</h1><p style="font-size:13px;color:rgba(255,255,255,0.6);max-width:320px;margin:8px auto 0">You'll no longer receive the daily AI briefing to this email. You can re-enable it anytime from your BetPool profile.</p></div></body></html>`);
    } catch (error: any) {
      res.status(500).type('html').send('<html><body style="background:#0A1428;color:#fff;font-family:sans-serif"><h1>Something went wrong</h1></body></html>');
    }
  }
}

export const digestController = new DigestController();