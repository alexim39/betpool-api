import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { aiCurationService } from './ai-curation.service';
import { adminService } from '../admin/admin.service';
import { CurationJobModel } from './curation-job.model';

export class AICurationController {
  async curate(req: AuthRequest, res: Response): Promise<void> {
    const job = await CurationJobModel.create({ status: 'pending', startedAt: new Date() });

    aiCurationService.curate().then(async (result) => {
      if (result.success && result.fixtures.length > 0) {
        const adminUserId = req.user!.userId;
        const createdPods: Array<{ fixtureId: number; homeTeam: string; awayTeam: string; podId: string; title: string }> = [];

        for (const fixture of result.fixtures) {
          if (fixture.verdict !== 'RECOMMEND') continue;

          const bestPick = fixture.recommendations.reduce(
            (best, r) => (r.confidence > (best?.confidence || 0) ? r : best),
            fixture.recommendations[0]
          );
          if (!bestPick) continue;

          try {
            const matchDate = new Date(fixture.matchDate);
            const stakingClosesAt = new Date(matchDate.getTime() - 24 * 60 * 60 * 1000);
            const settlementEstimateAt = new Date(matchDate.getTime() + 24 * 60 * 60 * 1000);

            const pod = await adminService.createPod({
              title: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
              sport: 'football',
              league: fixture.league,
              homeTeam: fixture.homeTeam,
              awayTeam: fixture.awayTeam,
              matchDate,
              marketType: fixture.isCombined ? 'parlay' as const : '1X2' as const,
              selection: bestPick.selection || fixture.selection || '',
              gainsMultiplier: fixture.multiplier || bestPick.recommendedMultiplier || 1.5,
              minStake: 100,
              maxStake: 100000,
              maxTotalExposure: 500000,
              opensAt: new Date(),
              stakingClosesAt,
              settlementEstimateAt,
              settlementEstimateLabel: settlementEstimateAt.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' }),
              status: 'active' as const,
              legs: [{ homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, matchDate, league: fixture.league }],
              metadata: {
                oraCurated: true,
                oraConfidence: bestPick.confidence,
                oraReasoning: fixture.overallReasoning,
                fixtureId: fixture.fixtureId,
                combined: fixture.isCombined,
                legMarkets: fixture.combinedLegs?.map(l => l.marketType),
                legSelections: fixture.combinedLegs?.map(l => l.selection),
              },
            }, adminUserId);

            createdPods.push({
              fixtureId: fixture.fixtureId,
              homeTeam: fixture.homeTeam,
              awayTeam: fixture.awayTeam,
              podId: pod._id.toString(),
              title: pod.title,
            });
          } catch (err: any) {
            result.errors.push(`Auto-create failed for ${fixture.homeTeam} vs ${fixture.awayTeam}: ${err.message}`);
          }
        }

        result.autoCreated = true;
        result.createdPods = createdPods;
      }

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
