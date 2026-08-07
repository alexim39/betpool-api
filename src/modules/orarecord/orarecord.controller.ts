import { Response } from 'express';
import { Request } from 'express';
import { oraRecordService } from './orarecord.service';

export class OraRecordController {
  async getRecord(req: Request, res: Response): Promise<void> {
    try {
      const league = typeof req.query.league === 'string' ? req.query.league.slice(0, 120) : undefined;
      const limit = parseInt(String(req.query.limit || '20'), 10);
      const refresh = req.query.refresh === 'true';
      const record = await oraRecordService.getRecord(refresh, { league, limit });
      res.json({ success: true, data: record });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to load Ora record' });
    }
  }
}

export const oraRecordController = new OraRecordController();
