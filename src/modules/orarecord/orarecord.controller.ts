import { Response } from 'express';
import { Request } from 'express';
import { oraRecordService } from './orarecord.service';

export class OraRecordController {
  async getRecord(_req: Request, res: Response): Promise<void> {
    try {
      const record = await oraRecordService.getRecord();
      res.json({ success: true, data: record });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to load Ora record' });
    }
  }
}

export const oraRecordController = new OraRecordController();
