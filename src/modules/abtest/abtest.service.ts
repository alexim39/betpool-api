import { AbTestModel, IAbTest } from './abtest.model';
import { AbTestEventModel } from './abtest-event.model';
import { logger } from '../../services/logger.service';

const EXPERIMENT_CACHE_TTL_MS = 60 * 1000;

export type Variant = 'control' | 'treatment';

interface CacheEntry {
  experiment: Pick<IAbTest, 'key' | 'enabled' | 'controlShare'> | null;
  expiresAt: number;
}

/** FNV-1a 32-bit hash — stable across restarts and processes. */
export function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic A/B test harness. Users are bucketed by a stable hash of
 * `userId + experimentKey`, so bucket assignments never flip between requests.
 * Experiments live in the `abtexperiments` collection and default to disabled —
 * no experiment configured means no behavior change anywhere.
 */
export class AbTestService {
  private cache = new Map<string, CacheEntry>();

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  private async getExperiment(key: string): Promise<Pick<IAbTest, 'key' | 'enabled' | 'controlShare'> | null> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.experiment;
    let experiment: Pick<IAbTest, 'key' | 'enabled' | 'controlShare'> | null = null;
    try {
      const doc = await AbTestModel.findOne({ key }).select('key enabled controlShare').lean();
      if (doc) experiment = { key: doc.key, enabled: doc.enabled, controlShare: doc.controlShare };
    } catch (e: any) {
      logger.warn(`[AbTest] experiment lookup failed for ${key}: ${e.message}`);
    }
    this.cache.set(key, { experiment, expiresAt: Date.now() + EXPERIMENT_CACHE_TTL_MS });
    return experiment;
  }

  /**
   * Buckets the user into the experiment variant, or null when the experiment
   * is not configured / disabled. Never throws.
   */
  async variantFor(userId: string, key: string): Promise<Variant | null> {
    try {
      const experiment = await this.getExperiment(key);
      if (!experiment || !experiment.enabled || !userId) return null;
      const controlShare = Math.min(100, Math.max(0, experiment.controlShare ?? 50));
      const bucket = fnv1a(`${key}:${userId}`) % 100;
      return bucket < controlShare ? 'control' : 'treatment';
    } catch {
      return null;
    }
  }

  /** Records an event for the user in an active experiment. Fail-soft. */
  async recordEvent(userId: string, key: string, event: string, meta: Record<string, any> = {}): Promise<void> {
    try {
      const variant = await this.variantFor(userId, key);
      if (!variant) return;
      await AbTestEventModel.create({ experimentKey: key, userId, variant, event, meta });
    } catch (e: any) {
      logger.warn(`[AbTest] event recording failed for ${key}/${userId}: ${e.message}`);
    }
  }

  async upsert(input: { key: string; description?: string; enabled?: boolean; controlShare?: number }): Promise<{ key: string; enabled: boolean; controlShare: number }> {
    const doc = await AbTestModel.findOneAndUpdate(
      { key: input.key },
      {
        $set: {
          description: input.description ?? '',
          enabled: input.enabled ?? false,
          controlShare: input.controlShare ?? 50,
        },
      },
      { new: true, upsert: true }
    );
    this.invalidate(input.key);
    return { key: doc.key, enabled: doc.enabled, controlShare: doc.controlShare };
  }

  async setEnabled(key: string, enabled: boolean): Promise<{ key: string; enabled: boolean } | null> {
    const doc = await AbTestModel.findOneAndUpdate(
      { key },
      { $set: { enabled } },
      { new: true }
    );
    if (!doc) return null;
    this.invalidate(key);
    return { key: doc.key, enabled: doc.enabled };
  }

  async list(): Promise<Array<Pick<IAbTest, 'key' | 'description' | 'enabled' | 'controlShare'>>> {
    return AbTestModel.find().sort({ createdAt: -1 }).select('key description enabled controlShare').lean();
  }

  /** Per-variant event counts and distinct user counts for an experiment. */
  async summary(key: string): Promise<{
    experiment: Pick<IAbTest, 'key' | 'enabled' | 'controlShare'> | null;
    events: Array<{ variant: string; event: string; count: number }>;
    users: { control: number; treatment: number };
  }> {
    const experiment = await this.getExperiment(key);
    const [eventRows, controlUsers, treatmentUsers] = await Promise.all([
      AbTestEventModel.aggregate([
        { $match: { experimentKey: key } },
        { $group: { _id: { variant: '$variant', event: '$event' }, count: { $sum: 1 } } },
        { $project: { _id: 0, variant: '$_id.variant', event: '$_id.event', count: 1 } },
        { $sort: { variant: 1, count: -1 } },
      ]),
      AbTestEventModel.distinct('userId', { experimentKey: key, variant: 'control' }),
      AbTestEventModel.distinct('userId', { experimentKey: key, variant: 'treatment' }),
    ]);
    return {
      experiment,
      events: eventRows,
      users: { control: controlUsers.length, treatment: treatmentUsers.length },
    };
  }
}

export const abtestService = new AbTestService();