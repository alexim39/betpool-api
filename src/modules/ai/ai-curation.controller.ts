import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { aiCurationService } from './ai-curation.service';
import { CurationJobModel } from './curation-job.model';

export class AICurationController {
  async curate(req: AuthRequest, res: Response): Promise<void> {
    const job = await CurationJobModel.create({ status: 'pending', startedAt: new Date() });

    aiCurationService.curate().then(async (result) => {
      await CurationJobModel.findByIdAndUpdate(job._id, {
        status: 'completed',
        result,
        completedAt: new Date(),
      });
    }).catch(async (error: any) => {
      console.error('AI curation error:', error);
      await CurationJobModel.findByIdAndUpdate(job._id, {
        status: 'failed',
        error: error.message || 'Curation failed',
        result: {
          success: false,
          total: 0, recommended: 0, skipped: 0,
          fixtures: [],
          errors: [error.message || 'Curation failed'],
          apiLog: [],
          skippedReason: null,
        },
        completedAt: new Date(),
      });
    });

    res.json({ success: true, jobId: job._id });
  }

  async getStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const job = await CurationJobModel.findById(req.params.jobId);
      if (!job) {
        res.status(404).json({ success: false, message: 'Job not found' });
        return;
      }
      if (job.status === 'completed') {
        res.json({ success: true, status: job.status, result: job.result });
      } else if (job.status === 'failed') {
        res.json({ success: false, status: job.status, error: job.error, result: job.result });
      } else {
        res.json({ success: true, status: job.status });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getLatest(req: AuthRequest, res: Response): Promise<void> {
    try {
      const job = await CurationJobModel.findOne().sort({ createdAt: -1 });
      if (!job) {
        res.json({ success: true, status: 'none', result: null });
        return;
      }
      if (job.status === 'completed') {
        res.json({ success: true, status: job.status, jobId: job._id, result: job.result });
      } else if (job.status === 'failed') {
        res.json({ success: false, status: job.status, jobId: job._id, error: job.error, result: job.result });
      } else {
        res.json({ success: true, status: job.status, jobId: job._id });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

export const aiCurationController = new AICurationController();
