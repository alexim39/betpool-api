import { UserModel, IUser } from '../models/user.model';
import { StakeModel } from '../models/stake.model';
import { WalletModel } from '../models/wallet.model';

export interface KycReviewResult {
  userId: string;
  fullName: string;
  phone: string;
  kycType: string | null;
  kycNumber: string | null;
  registeredName: string;
  verifiedName: string | null;
  namesMatch: boolean;
  duplicateBvnNin: boolean;
  duplicateAccountCount: number;
  accountAgeDays: number;
  hasStakes: boolean;
  totalStakeVolume: number;
  recommendedAction: 'approve' | 'reject' | 'manual_review';
  confidence: number;
  riskFlags: string[];
  reasoning: string;
}

export class AIKycService {
  async reviewUser(userId: string): Promise<KycReviewResult> {
    const user = await UserModel.findById(userId).lean();
    if (!user) throw new Error('User not found');

    const verifiedName = user.kycType === 'bvn'
      ? (user.kycData as any)?.bvnVerifiedName || null
      : (user.kycData as any)?.ninVerifiedName || null;

    const registeredName = user.fullName || '';
    const namesMatch = this.checkNamesMatch(registeredName, verifiedName);

    // Check for duplicate BVN/NIN across accounts
    const dupField = user.kycType === 'bvn' ? 'kycData.bvn' : 'kycData.nin';
    const dupCount = await UserModel.countDocuments({
      _id: { $ne: user._id },
      [dupField]: user.kycNumber,
    });

    // Account age
    const accountAgeMs = Date.now() - new Date(user.createdAt).getTime();
    const accountAgeDays = Math.floor(accountAgeMs / 86400000);

    // Stake activity
    const stakes = await StakeModel.find({ user: user._id }).lean();
    const hasStakes = stakes.length > 0;
    const totalStakeVolume = stakes.reduce((sum, s) => sum + (s.stakeAmount || 0), 0);

    const wallet = await WalletModel.findOne({ user: user._id }).lean();
    const walletBalance = wallet?.balance || 0;

    const riskFlags: string[] = [];

    if (!verifiedName) riskFlags.push('No verified name from BVN/NIN lookup');
    if (!namesMatch && verifiedName) riskFlags.push(`Name mismatch: registered "${registeredName}" vs verified "${verifiedName}"`);
    if (dupCount > 0) riskFlags.push(`Same ${user.kycType?.toUpperCase()} used by ${dupCount} other account(s)`);
    if (accountAgeDays < 1) riskFlags.push('Account created less than 24 hours ago');
    if (!hasStakes) riskFlags.push('User has never placed a stake');
    if (walletBalance === 0) riskFlags.push('Zero wallet balance (no financial activity)');

    let recommendedAction: 'approve' | 'reject' | 'manual_review';
    let confidence: number;
    let reasoning: string;

    if (dupCount > 0) {
      recommendedAction = 'reject';
      confidence = 95;
      reasoning = `Duplicate ${user.kycType?.toUpperCase()} detected: ${user.kycNumber} is used by ${dupCount} other account(s). This strongly indicates identity fraud.`;
    } else if (namesMatch && accountAgeDays >= 1) {
      recommendedAction = 'approve';
      confidence = 90;
      reasoning = `Name on ${user.kycType?.toUpperCase()} matches registered name. Account is ${accountAgeDays} day(s) old. No duplicates found.`;
    } else if (!namesMatch && verifiedName) {
      recommendedAction = 'manual_review';
      confidence = 60;
      reasoning = `Name mismatch: "${registeredName}" vs verified "${verifiedName}". Could be a typo, married name, or fraud. Manual verification recommended.`;
    } else if (!verifiedName) {
      recommendedAction = 'manual_review';
      confidence = 40;
      reasoning = `${user.kycType?.toUpperCase()} verification returned no name data. Cannot auto-verify.`;
    } else {
      recommendedAction = 'manual_review';
      confidence = 50;
      reasoning = `Mixed signals — review flags: ${riskFlags.join(', ')}`;
    }

    return {
      userId: user._id.toString(),
      fullName: registeredName,
      phone: user.phone,
      kycType: user.kycType,
      kycNumber: user.kycNumber,
      registeredName,
      verifiedName,
      namesMatch,
      duplicateBvnNin: dupCount > 0,
      duplicateAccountCount: dupCount,
      accountAgeDays,
      hasStakes,
      totalStakeVolume,
      recommendedAction,
      confidence,
      riskFlags,
      reasoning,
    };
  }

  private checkNamesMatch(registered: string, verified: string | null): boolean {
    if (!registered || !verified) return false;
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const r = norm(registered);
    const v = norm(verified);
    return r.includes(v) || v.includes(r);
  }

  async reviewAllPending(): Promise<{ reviewed: number; approved: number; rejected: number; manual: number; results: KycReviewResult[]; errors: string[] }> {
    const pendingUsers = await UserModel.find({
      kycVerified: false,
      kycType: { $ne: null },
      kycNumber: { $ne: '' },
    }).lean();

    let approved = 0;
    let rejected = 0;
    let manual = 0;
    const results: KycReviewResult[] = [];
    const errors: string[] = [];

    for (const user of pendingUsers) {
      try {
        const result = await this.reviewUser(user._id.toString());
        results.push(result);
        if (result.recommendedAction === 'approve') approved++;
        else if (result.recommendedAction === 'reject') rejected++;
        else manual++;
      } catch (err: any) {
        errors.push(`User ${user._id}: ${err.message}`);
      }
    }

    return { reviewed: results.length, approved, rejected, manual, results, errors };
  }
}

export const aiKycService = new AIKycService();
