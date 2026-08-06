import mongoose from 'mongoose';
import crypto from 'crypto';
import { VirtualGamePlayModel, VirtualGameId } from './virtual-games.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import { walletService } from '../../services/wallet.service';
import { createInAppNotification } from '../../services/notification.service';
import { loyaltyService } from '../loyalty/loyalty.service';
import { logger } from '../../services/logger.service';

export const VIRTUAL_GAMES_ENABLED = process.env.VIRTUAL_GAMES_ENABLED !== 'disabled';
const MAX_STAKE = Math.max(100, parseInt(process.env.VIRTUAL_GAMES_MAX_STAKE || '50000', 10));
const DAILY_CAP = Math.max(0, parseInt(process.env.VIRTUAL_GAMES_DAILY_CAP || '200000', 10));
const MIN_STAKE = 100;

export interface VirtualGameConfig {
  id: VirtualGameId;
  name: string;
  description: string;
  icon: string;
  multiplier: number;
  minStake: number;
  maxStake: number;
  outcomes: string[];
  rtpPercent: number;
}

export const VIRTUAL_GAMES: Record<VirtualGameId, VirtualGameConfig> = {
  coin_flip: {
    id: 'coin_flip',
    name: 'Coin Flip',
    description: 'Pick heads or tails. Win at 1.9x your stake.',
    icon: 'monetization_on',
    multiplier: 1.9,
    minStake: MIN_STAKE,
    maxStake: MAX_STAKE,
    outcomes: ['heads', 'tails'],
    rtpPercent: 95,
  },
  dice: {
    id: 'dice',
    name: 'Dice Roll',
    description: 'Call the exact face of a fair 6-sided die. Pays 5.7x.',
    icon: 'casino',
    multiplier: 5.7,
    minStake: MIN_STAKE,
    maxStake: MAX_STAKE,
    outcomes: ['1', '2', '3', '4', '5', '6'],
    rtpPercent: 95,
  },
  color_wheel: {
    id: 'color_wheel',
    name: 'Color Wheel',
    description: 'Pick a color — emerald, gold or white. Win at 2.8x.',
    icon: 'palette',
    multiplier: 2.8,
    minStake: MIN_STAKE,
    maxStake: MAX_STAKE,
    outcomes: ['emerald', 'gold', 'white'],
    rtpPercent: 93.3,
  },
};

export interface CatalogEntry extends VirtualGameConfig {
  enabled: boolean;
}

export interface PlayRequest {
  userId: string;
  game: VirtualGameId;
  choice: string;
  amount: number;
  idempotencyKey?: string;
}

export interface PlayResult {
  playId: string;
  game: VirtualGameId;
  choice: string;
  outcome: string;
  result: 'win' | 'loss';
  stakeAmount: number;
  multiplier: number;
  payoutAmount: number;
  seed: string;
  verificationHash: string;
  balanceAfter: number;
  playedAt: string;
}

export interface VirtualGameStats {
  totalPlays: number;
  totalStaked: number;
  totalWins: number;
  totalPayout: number;
  winRate: number;
  today: { plays: number; staked: number; won: number };
  bestWin: { amount: number; game: VirtualGameId } | null;
}

export interface HistoryFilter {
  userId?: string;
  page?: number;
  limit?: number;
  game?: VirtualGameId;
  result?: 'win' | 'loss';
}

const VALID_GAME_IDS: VirtualGameId[] = ['coin_flip', 'dice', 'color_wheel'];

/**
 * Deterministic outcome derivation from a server seed + play nonce.
 * Pure function so clients can recompute and verify the result:
 *   outcomeIdx = sha256(seed + ':' + playId) mod outcomes.length
 */
export function deriveOutcome(game: VirtualGameId, seed: string, playId: string): string {
  const hash = crypto.createHash('sha256').update(`${seed}:${playId}`).digest('hex');
  const big = BigInt('0x' + hash);
  const n = BigInt(VIRTUAL_GAMES[game].outcomes.length);
  return VIRTUAL_GAMES[game].outcomes[Number(big % n)];
}

export function makeSeed(): string {
  return crypto.randomBytes(32).toString('hex');
}

export class VirtualGamesService {
  getCatalog(): CatalogEntry[] {
    return Object.values(VIRTUAL_GAMES).map(g => ({
      ...g,
      enabled: VIRTUAL_GAMES_ENABLED,
    }));
  }

  private getGame(game: VirtualGameId): VirtualGameConfig {
    const cfg = VIRTUAL_GAMES[game];
    if (!cfg) throw new Error('Unknown game');
    return cfg;
  }

  private async todayStaked(userId: string): Promise<number> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    let userIdMatch: mongoose.Types.ObjectId | string = userId;
    try {
      userIdMatch = new mongoose.Types.ObjectId(userId);
    } catch {
      // fall back to raw string — still matches when stored as ObjectId via cast in production
    }
    const [agg] = await VirtualGamePlayModel.aggregate([
      { $match: { user: userIdMatch, playedAt: { $gte: start } } },
      { $group: { _id: null, total: { $sum: '$stakeAmount' } } },
    ]);
    return agg?.total ?? 0;
  }

  async play(req: PlayRequest): Promise<PlayResult> {
    if (!VIRTUAL_GAMES_ENABLED) throw new Error('Virtual games are currently disabled');

    const cfg = this.getGame(req.game);

    if (!cfg.outcomes.includes(req.choice)) {
      throw new Error(`Choice must be one of: ${cfg.outcomes.join(', ')}`);
    }
    if (req.amount < cfg.minStake) {
      throw new Error(`Minimum stake is ₦${cfg.minStake.toLocaleString()}`);
    }
    if (req.amount > cfg.maxStake) {
      throw new Error(`Maximum stake is ₦${cfg.maxStake.toLocaleString()}`);
    }

    if (req.idempotencyKey) {
      const existing = await VirtualGamePlayModel.findOne({
        user: req.userId,
        'metadata.idempotencyKey': req.idempotencyKey,
      }).lean();
      if (existing) {
        const wallet = await walletService.getBalance(req.userId);
        return this.toResult(existing, wallet.available);
      }
    }

    const todayTotal = await this.todayStaked(req.userId);
    if (DAILY_CAP > 0 && todayTotal + req.amount > DAILY_CAP) {
      throw new Error(`Daily play limit reached — ₦${DAILY_CAP.toLocaleString()} staked across virtual games per day`);
    }

    const seed = makeSeed();
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const wallet = await WalletModel.findOneAndUpdate(
        {
          user: req.userId,
          $expr: { $gte: [{ $subtract: ['$balance', '$lockedBalance'] }, req.amount] }
        },
        { $inc: { balance: -req.amount }, $set: { lastTransactionAt: new Date() } },
        { new: true, session }
      );
      if (!wallet) {
        throw new Error('Insufficient balance');
      }

      const playDoc = await VirtualGamePlayModel.create([{
        user: req.userId,
        game: req.game,
        stakeAmount: req.amount,
        multiplier: cfg.multiplier,
        result: 'loss',
        payoutAmount: 0,
        outcome: '',
        choice: req.choice,
        seed: '',
        verificationHash: '',
        status: 'completed',
        metadata: {
          ...(req.idempotencyKey ? { idempotencyKey: req.idempotencyKey } : {}),
        },
      }], { session });

      const playId = String(playDoc[0]._id);
      const outcome = deriveOutcome(req.game, seed, playId);
      const won = outcome === req.choice;
      const payoutAmount = won ? Math.floor(req.amount * cfg.multiplier) : 0;
      const verificationHash = crypto.createHash('sha256').update(seed).digest('hex');

      playDoc[0].outcome = outcome;
      playDoc[0].result = won ? 'win' : 'loss';
      playDoc[0].payoutAmount = payoutAmount;
      playDoc[0].seed = seed;
      playDoc[0].verificationHash = verificationHash;
      await playDoc[0].save({ session });

      if (won) {
        const credited = await WalletModel.findOneAndUpdate(
          { user: req.userId },
          {
            $inc: { balance: payoutAmount, totalWon: payoutAmount },
            $set: { lastTransactionAt: new Date() },
          },
          { session, new: true }
        );
        if (!credited) throw new Error('Wallet not found');

        await TransactionModel.create([{
          user: req.userId,
          wallet: credited._id,
          type: 'payout',
          status: 'completed',
          amount: payoutAmount,
          fee: 0,
          netAmount: payoutAmount,
          balanceBefore: credited.balance - payoutAmount,
          balanceAfter: credited.balance,
          currency: 'NGN',
          reference: `VGAME_WIN_${playId}`,
          provider: 'internal',
          metadata: { game: req.game, outcome, choice: req.choice, description: 'Virtual game win' },
          processedAt: new Date(),
        }], { session });
      }

      await TransactionModel.create([{
        user: req.userId,
        wallet: wallet._id,
        type: 'stake',
        status: 'completed',
        amount: req.amount,
        fee: 0,
        netAmount: req.amount,
        balanceBefore: wallet.balance + req.amount,
        balanceAfter: wallet.balance,
        currency: 'NGN',
        reference: `VGAME_STAKE_${playId}`,
        provider: 'internal',
        metadata: { game: req.game, choice: req.choice, description: 'Virtual game stake' },
        processedAt: new Date(),
      }], { session });

      await session.commitTransaction();

      const balance = await walletService.getBalance(req.userId);

      loyaltyService.onStakePlaced(req.userId, req.amount).catch(e => logger.error('Loyalty points error (virtual game)', e));

      if (won) {
        await createInAppNotification(
          req.userId,
          'payout',
          'Instant Win! 🎉',
          `You won ₦${payoutAmount.toLocaleString()} on ${cfg.name} (${req.choice})`,
          { virtualGame: req.game, payoutAmount }
        ).catch(e => logger.error('Virtual game win notification error', e));
      }

      return {
        playId,
        game: req.game,
        choice: req.choice,
        outcome,
        result: won ? 'win' : 'loss',
        stakeAmount: req.amount,
        multiplier: cfg.multiplier,
        payoutAmount,
        seed,
        verificationHash,
        balanceAfter: balance.available,
        playedAt: new Date().toISOString(),
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  private toResult(play: any, balanceAfter: number): PlayResult {
    return {
      playId: String(play._id),
      game: play.game,
      choice: play.choice,
      outcome: play.outcome,
      result: play.result,
      stakeAmount: play.stakeAmount,
      multiplier: play.multiplier,
      payoutAmount: play.payoutAmount,
      seed: play.seed,
      verificationHash: play.verificationHash,
      balanceAfter,
      playedAt: new Date(play.playedAt).toISOString(),
    };
  }

  async history(filter: HistoryFilter = {}, userId?: string): Promise<{ items: any[]; total: number }> {
    const uid = userId ?? filter.userId;
    const page = Math.max(1, Math.floor(filter.page || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(filter.limit || 20)));
    const skip = (page - 1) * limit;
    const query: Record<string, any> = { user: uid };
    if (filter.game && VALID_GAME_IDS.includes(filter.game)) query.game = filter.game;
    if (filter.result === 'win' || filter.result === 'loss') query.result = filter.result;
    const [items, total] = await Promise.all([
      VirtualGamePlayModel.find(query)
        .sort({ playedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      VirtualGamePlayModel.countDocuments(query),
    ]);
    return { items: items as any[], total };
  }

  async summary(userId: string): Promise<VirtualGameStats> {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const id = this.toUserIdSafe(userId);
    const [rows] = await VirtualGamePlayModel.aggregate([
      { $match: { user: id } },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                plays: { $sum: 1 },
                staked: { $sum: '$stakeAmount' },
                wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
                payout: { $sum: '$payoutAmount' },
              },
            },
          ],
          today: [
            { $match: { playedAt: { $gte: startOfToday } } },
            {
              $group: {
                _id: null,
                plays: { $sum: 1 },
                staked: { $sum: '$stakeAmount' },
                won: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, '$payoutAmount', 0] } },
              },
            },
          ],
          bestWin: [
            { $sort: { payoutAmount: -1, playedAt: -1 } },
            { $limit: 1 },
            { $project: { _id: 0, amount: '$payoutAmount', game: 1 } },
          ],
        },
      },
    ]);

    const totals = rows?.totals?.[0];
    const todayRow = rows?.today?.[0];
    const best = rows?.bestWin?.[0];

    return {
      totalPlays: totals?.plays ?? 0,
      totalStaked: totals?.staked ?? 0,
      totalWins: totals?.wins ?? 0,
      totalPayout: totals?.payout ?? 0,
      winRate: totals && totals.plays > 0 ? Math.round(((totals.wins || 0) / totals.plays) * 100) : 0,
      today: {
        plays: todayRow?.plays ?? 0,
        staked: todayRow?.staked ?? 0,
        won: todayRow?.won ?? 0,
      },
      bestWin: best?.amount && best.amount > 0
        ? { amount: best.amount, game: best.game as VirtualGameId }
        : null,
    };
  }

  private toUserIdSafe(userId: string): mongoose.Types.ObjectId | string {
    try {
      return new mongoose.Types.ObjectId(userId);
    } catch {
      return userId;
    }
  }
}

export const virtualGamesService = new VirtualGamesService();
