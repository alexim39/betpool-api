import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { abtestService } from './abtest.service';

export class AbTestController {
  async assignment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const key = String(req.query.key || '');
      if (!key) {
        res.status(400).json({ success: false, message: 'Experiment key is required' });
        return;
      }
      const variant = await abtestService.variantFor(req.user!.userId, key);
      res.json({ success: true, key, variant });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async upsert(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { key, description, enabled, controlShare } = req.body || {};
      if (!key || typeof key !== 'string') {
        res.status(400).json({ success: false, message: 'Experiment key is required' });
        return;
      }
      const experiment = await abtestService.upsert({
        key,
        description,
        enabled: typeof enabled === 'boolean' ? enabled : undefined,
        controlShare: typeof controlShare === 'number' ? controlShare : undefined,
      });
      res.json({ success: true, experiment });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async toggle(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { key, enabled } = req.body || {};
      if (!key || typeof enabled !== 'boolean') {
        res.status(400).json({ success: false, message: 'key and enabled (boolean) are required' });
        return;
      }
      const experiment = await abtestService.setEnabled(key, enabled);
      if (!experiment) {
        res.status(404).json({ success: false, message: `Experiment ${key} not found` });
        return;
      }
      res.json({ success: true, experiment });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      const experiments = await abtestService.list();
      res.json({ success: true, experiments });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async summary(req: AuthRequest, res: Response): Promise<void> {
    try {
      const key = String(req.params.key || '');
      if (!key) {
        res.status(400).json({ success: false, message: 'Experiment key is required' });
        return;
      }
      const summary = await abtestService.summary(key);
      res.json({ success: true, ...summary });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

export const abtestController = new AbTestController();