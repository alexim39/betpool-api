import { StakeModel } from '../../models/stake.model';
import { PodModel } from '../../models/pod.model';
import { UserModel } from '../../models/user.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import { createInAppNotification } from '../../services/notification.service';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

export interface ForecastMetric {
  current: number;
  previous: number;
  changePercent: number;
  projectedNext: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface FinancialForecast {
  period: string;
  days: number;
  forecastDate: string;
  revenue: ForecastMetric;
  stakes: ForecastMetric;
  volume: ForecastMetric;
  newUsers: ForecastMetric;
  netProfit: ForecastMetric;
  summary: string;
}

export interface T4Advisory {
  timestamp: string;
  healthScore: number;
  healthLabel: 'good' | 'fair' | 'needs_attention' | 'critical';
  metrics: {
    profitMargin: { value: number; status: 'good' | 'warning' | 'critical' };
    userGrowth: { value: number; status: 'good' | 'warning' | 'critical' };
    kycRate: { value: number; status: 'good' | 'warning' | 'critical' };
    netDeposits: { value: number; status: 'good' | 'warning' | 'critical' };
    churnRate: { value: number; status: 'good' | 'warning' | 'critical' };
    revenueTrend: { value: number; status: 'good' | 'warning' | 'critical' };
  };
  warnings: string[];
  recommendations: string[];
  previousHealthScore: number;
  healthChange: 'improving' | 'stable' | 'deteriorating';
}

export interface BIReport {
  period: string;
  dateFrom: string;
  dateTo: string;
  overview: {
    totalRevenue: number;
    totalPayouts: number;
    netProfit: number;
    totalStakes: number;
    totalVolume: number;
    totalUsers: number;
    newUsers: number;
    churnedUsers: number;
    activeUsers: number;
  };
  bySport: Array<{ sport: string; stakes: number; volume: number; revenue: number; payouts: number; profit: number }>;
  byLeague: Array<{ league: string; stakes: number; volume: number; revenue: number; payouts: number; profit: number }>;
  revenueBreakdown: {
    commissionFees: number;
    cashoutFees: number;
    totalRevenue: number;
  };
  userMetrics: {
    total: number;
    newLastPeriod: number;
    kycVerified: number;
    kycRate: number;
    totalDeposits: number;
    totalWithdrawals: number;
    netDeposits: number;
  };
  topPods: Array<{ title: string; sport: string; stakes: number; volume: number; profit: number }>;
  topUsers: Array<{ phone: string; totalStaked: number; totalWon: number; stakeCount: number }>;
  monthOverMonth: {
    stakesChange: number;
    volumeChange: number;
    revenueChange: number;
    usersChange: number;
  };
  aiInsight: string;
}

export class AIBIService {
  private get deepseekKey(): string { return process.env.DEEPSEEK_API_KEY || ''; }

  async generateReport(days: number = 30): Promise<BIReport> {
    const now = new Date();
    const dateTo = now.toISOString();
    const periodStart = new Date(now.getTime() - days * 86400000);
    const dateFrom = periodStart.toISOString();
    const prevPeriodStart = new Date(periodStart.getTime() - days * 86400000);

    // Revenue from settled stakes
    const settledStakes = await StakeModel.find({
      status: { $in: ['won', 'lost'] },
      createdAt: { $gte: periodStart, $lte: now },
    }).populate('pod', 'sport league title').lean();

    const totalRevenue = settledStakes.reduce((sum, s) => sum + (s.platformFee || 0), 0);
    const totalPayouts = settledStakes
      .filter(s => s.status === 'won')
      .reduce((sum, s) => sum + (s.netPayout || 0), 0);
    const totalStakesVolume = settledStakes.reduce((sum, s) => sum + (s.stakeAmount || 0), 0);
    const netProfit = totalRevenue - totalPayouts;

    // Cashout fees
    const cashouts = await StakeModel.find({
      status: 'cashed_out',
      createdAt: { $gte: periodStart, $lte: now },
    }).lean();
    const cashoutFees = cashouts.reduce((sum, s) => sum + ((s.stakeAmount || 0) - (s.cashoutAmount || 0)), 0);

    // Revenue by sport
    const sportMap = new Map<string, { stakes: number; volume: number; revenue: number; payouts: number }>();
    for (const s of settledStakes) {
      const sport = (s.pod as any)?.sport || 'Unknown';
      const curr = sportMap.get(sport) || { stakes: 0, volume: 0, revenue: 0, payouts: 0 };
      curr.stakes++;
      curr.volume += s.stakeAmount || 0;
      curr.revenue += s.platformFee || 0;
      if (s.status === 'won') curr.payouts += s.netPayout || 0;
      sportMap.set(sport, curr);
    }
    const bySport = Array.from(sportMap.entries()).map(([sport, d]) => ({
      sport, ...d, profit: d.revenue - d.payouts,
    })).sort((a, b) => b.profit - a.profit);

    // Revenue by league
    const leagueMap = new Map<string, { stakes: number; volume: number; revenue: number; payouts: number }>();
    for (const s of settledStakes) {
      const league = (s.pod as any)?.league || 'Unknown';
      const curr = leagueMap.get(league) || { stakes: 0, volume: 0, revenue: 0, payouts: 0 };
      curr.stakes++;
      curr.volume += s.stakeAmount || 0;
      curr.revenue += s.platformFee || 0;
      if (s.status === 'won') curr.payouts += s.netPayout || 0;
      leagueMap.set(league, curr);
    }
    const byLeague = Array.from(leagueMap.entries()).map(([league, d]) => ({
      league, ...d, profit: d.revenue - d.payouts,
    })).sort((a, b) => b.profit - a.profit);

    // User metrics
    const totalUsers = await UserModel.countDocuments();
    const newUsers = await UserModel.countDocuments({ createdAt: { $gte: periodStart } });
    const prevNewUsers = await UserModel.countDocuments({ createdAt: { $gte: prevPeriodStart, $lt: periodStart } });
    const kycVerified = await UserModel.countDocuments({ kycVerified: true });
    const activeUsers = await WalletModel.countDocuments({ balance: { $gt: 0 } });

    // Churned users (were active before period start, no activity during period)
    const usersBeforePeriod = await UserModel.countDocuments({ createdAt: { $lt: periodStart } });
    const usersActiveDuring = await StakeModel.distinct('user', { createdAt: { $gte: periodStart } });
    const churnedUsers = Math.max(0, usersBeforePeriod - usersActiveDuring.length);

    // Deposits/withdrawals
    const depositAgg = await TransactionModel.aggregate([
      { $match: { type: 'deposit', status: 'completed', createdAt: { $gte: periodStart, $lte: now } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalDeposits = depositAgg[0]?.total || 0;

    const withdrawalAgg = await TransactionModel.aggregate([
      { $match: { type: 'withdrawal', status: 'completed', createdAt: { $gte: periodStart, $lte: now } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalWithdrawals = withdrawalAgg[0]?.total || 0;

    // Top pods by profit
    const podMap = new Map<string, { title: string; sport: string; stakes: number; volume: number; profit: number }>();
    for (const s of settledStakes) {
      const podId = s.pod?._id?.toString() || 'unknown';
      const pData = s.pod as any;
      const curr = podMap.get(podId) || { title: pData?.title || 'Unknown', sport: pData?.sport || '', stakes: 0, volume: 0, profit: 0 };
      curr.stakes++;
      curr.volume += s.stakeAmount || 0;
      const profit = s.status === 'won' ? -(s.netPayout || 0) + (s.platformFee || 0) : (s.platformFee || 0);
      curr.profit += profit;
      podMap.set(podId, curr);
    }
    const topPods = Array.from(podMap.values())
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10);

    // Top users
    const topUsersRaw = await StakeModel.aggregate([
      { $match: { createdAt: { $gte: periodStart, $lte: now } } },
      { $group: { _id: '$user', totalStaked: { $sum: '$stakeAmount' }, totalWon: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, '$netPayout', 0] } }, stakeCount: { $sum: 1 } } },
      { $sort: { totalStaked: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      { $project: { phone: '$user.phone', totalStaked: 1, totalWon: 1, stakeCount: 1 } },
    ]);
    const topUsers = await topUsersRaw;

    // Month-over-month comparison
    const prevStakes = await StakeModel.countDocuments({ createdAt: { $gte: prevPeriodStart, $lt: periodStart } });
    const prevVolumeAgg = await StakeModel.aggregate([
      { $match: { createdAt: { $gte: prevPeriodStart, $lt: periodStart } } },
      { $group: { _id: null, total: { $sum: '$stakeAmount' } } },
    ]);
    const prevVolume = prevVolumeAgg[0]?.total || 0;

    const prevRevenueAgg = await StakeModel.aggregate([
      { $match: { status: { $in: ['won', 'lost'] }, createdAt: { $gte: prevPeriodStart, $lt: periodStart } } },
      { $group: { _id: null, total: { $sum: '$platformFee' } } },
    ]);
    const prevRevenue = prevRevenueAgg[0]?.total || 0;

    const monthOverMonth = {
      stakesChange: prevStakes > 0 ? Math.round(((settledStakes.length - prevStakes) / prevStakes) * 100) : 0,
      volumeChange: prevVolume > 0 ? Math.round(((totalStakesVolume - prevVolume) / prevVolume) * 100) : 0,
      revenueChange: prevRevenue > 0 ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100) : 0,
      usersChange: prevNewUsers > 0 ? Math.round(((newUsers - prevNewUsers) / prevNewUsers) * 100) : 0,
    };

    // AI insight
    const aiInsight = await this.generateInsight({
      revenue: totalRevenue, payouts: totalPayouts, profit: netProfit,
      stakes: settledStakes.length, users: totalUsers, newUsers,
      topSport: bySport[0], topLeague: byLeague[0],
      monthOverMonth, churnedUsers, kycRate: totalUsers > 0 ? Math.round((kycVerified / totalUsers) * 100) : 0,
      netDeposits: totalDeposits - totalWithdrawals,
      activeUsers,
    });

    return {
      period: `${days}-day`,
      dateFrom, dateTo,
      overview: {
        totalRevenue, totalPayouts, netProfit,
        totalStakes: settledStakes.length,
        totalVolume: totalStakesVolume,
        totalUsers, newUsers, churnedUsers, activeUsers,
      },
      bySport, byLeague,
      revenueBreakdown: {
        commissionFees: totalRevenue,
        cashoutFees,
        totalRevenue: totalRevenue + cashoutFees,
      },
      userMetrics: {
        total: totalUsers,
        newLastPeriod: newUsers,
        kycVerified,
        kycRate: totalUsers > 0 ? Math.round((kycVerified / totalUsers) * 100) : 0,
        totalDeposits, totalWithdrawals,
        netDeposits: totalDeposits - totalWithdrawals,
      },
      topPods, topUsers,
      monthOverMonth,
      aiInsight,
    };
  }

  private async generateInsight(data: any): Promise<string> {
    if (!this.deepseekKey || this.deepseekKey === 'your_deepseek_api_key_here') {
      return 'AI insights require DEEPSEEK_API_KEY. Set it in .env for AI-powered business analysis.';
    }

    const prompt = `Analyze this BetPool business data for the last 30 days and provide 3-4 actionable insights:

Revenue: ₦${data.revenue.toLocaleString()}
Payouts: ₦${data.payouts.toLocaleString()}
Net Profit: ₦${data.profit.toLocaleString()}
Total Stakes: ${data.stakes}
Total Users: ${data.users}
New Users: ${data.newUsers}
Active Users: ${data.activeUsers}
Churned Users: ${data.churnedUsers}
KYC Rate: ${data.kycRate}%
Net Deposits: ₦${data.netDeposits.toLocaleString()}
Top Sport: ${data.topSport?.sport || 'N/A'} (profit: ₦${(data.topSport?.profit || 0).toLocaleString()})
Top League: ${data.topLeague?.league || 'N/A'} (profit: ₦${(data.topLeague?.profit || 0).toLocaleString()})
MoM Stake Change: ${data.monthOverMonth.stakesChange}%
MoM Volume Change: ${data.monthOverMonth.volumeChange}%
MoM Revenue Change: ${data.monthOverMonth.revenueChange}%
MoM Users Change: ${data.monthOverMonth.usersChange}%

Return ONLY a JSON object:
{
  "insights": ["string", "string", "string"],
  "recommendations": ["string", "string"],
  "overallHealth": "good" | "fair" | "needs_attention"
}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      let response;
      try {
        response = await fetch(DEEPSEEK_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.deepseekKey}` },
          body: JSON.stringify({
            model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
            messages: [
              { role: 'system', content: 'You are Ora, BetPool\'s business intelligence analyst. Analyze performance data and provide concise, actionable insights for the CEO.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 600,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) return 'AI insight generation unavailable.';
      const res = await response.json();
      const content = res.choices?.[0]?.message?.content;
      if (!content) return 'AI insight generation unavailable.';

      const parsed = JSON.parse(content.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim());
      const parts: string[] = [];
      if (parsed.insights?.length) parts.push('📊 **Insights:**\n' + parsed.insights.map((i: string) => `• ${i}`).join('\n'));
      if (parsed.recommendations?.length) parts.push('\n📋 **Recommendations:**\n' + parsed.recommendations.map((r: string) => `• ${r}`).join('\n'));
      if (parsed.overallHealth) parts.push(`\n🏥 **Overall Health:** ${parsed.overallHealth.replace(/_/g, ' ').toUpperCase()}`);
      return parts.join('\n');
    } catch {
      return 'AI insight generation failed.';
    }
  }

  async generateForecast(days: number = 30): Promise<FinancialForecast> {
    const report = await this.generateReport(days);
    const prevDays = days;
    const prevPeriodStart = new Date(new Date().getTime() - prevDays * 2 * 86400000);
    const prevEnd = new Date(new Date().getTime() - prevDays * 86400000);

    const prevStakes = await StakeModel.countDocuments({
      createdAt: { $gte: prevPeriodStart, $lt: prevEnd },
    });
    const prevVolumeAgg = await StakeModel.aggregate([
      { $match: { createdAt: { $gte: prevPeriodStart, $lt: prevEnd } } },
      { $group: { _id: null, total: { $sum: '$stakeAmount' } } },
    ]);
    const prevVolume = prevVolumeAgg[0]?.total || 0;

    const prevRevenueAgg = await StakeModel.aggregate([
      { $match: { status: { $in: ['won', 'lost'] }, createdAt: { $gte: prevPeriodStart, $lt: prevEnd } } },
      { $group: { _id: null, total: { $sum: '$platformFee' } } },
    ]);
    const prevRevenue = prevRevenueAgg[0]?.total || 0;

    const prevUsers = await UserModel.countDocuments({
      createdAt: { $gte: prevPeriodStart, $lt: prevEnd },
    });
    const prevProfit = prevRevenue - await StakeModel.aggregate([
      { $match: { status: 'won', createdAt: { $gte: prevPeriodStart, $lt: prevEnd } } },
      { $group: { _id: null, total: { $sum: '$netPayout' } } },
    ]).then(r => r[0]?.total || 0);

    const calcForecast = (current: number, previous: number, label: string): ForecastMetric => {
      const change = previous > 0 ? ((current - previous) / previous) * 100 : 0;
      const projected = current + (current * (change / 100));
      const dataPoints = current + previous;
      const confidence: 'high' | 'medium' | 'low' =
        dataPoints > 100 ? 'high' : dataPoints > 20 ? 'medium' : 'low';
      return { current, previous, changePercent: Math.round(change), projectedNext: Math.round(projected), confidence };
    };

    const forecast: FinancialForecast = {
      period: `${days}-day`,
      days,
      forecastDate: new Date(Date.now() + days * 86400000).toISOString(),
      revenue: calcForecast(report.overview.totalRevenue, prevRevenue, 'Revenue'),
      stakes: calcForecast(report.overview.totalStakes, prevStakes, 'Stakes'),
      volume: calcForecast(report.overview.totalVolume, prevVolume, 'Volume'),
      newUsers: calcForecast(report.overview.newUsers, prevUsers, 'New Users'),
      netProfit: calcForecast(report.overview.netProfit, prevProfit, 'Net Profit'),
      summary: '',
    };

    const direction = forecast.revenue.changePercent >= 0 ? 'growth' : 'decline';
    const confidenceText = [forecast.revenue, forecast.stakes, forecast.newUsers]
      .filter(m => m.confidence === 'high').length >= 2 ? 'with high confidence' : 'with moderate confidence';
    forecast.summary = `Next ${days}-day period: projected revenue ₦${forecast.revenue.projectedNext.toLocaleString()} (${forecast.revenue.changePercent >= 0 ? '+' : ''}${forecast.revenue.changePercent}%), ` +
      `stakes ${forecast.stakes.projectedNext} (${forecast.stakes.changePercent >= 0 ? '+' : ''}${forecast.stakes.changePercent}%), ` +
      `new users ${forecast.newUsers.projectedNext} (${forecast.newUsers.changePercent >= 0 ? '+' : ''}${forecast.newUsers.changePercent}%) — ` +
      `${direction} trend ${confidenceText}.`;

    return forecast;
  }

  async generateT4Advisory(): Promise<T4Advisory> {
    const report = await this.generateReport(30);
    const prevReport = await this.generateReport(60);

    const profitMargin = report.overview.totalRevenue > 0
      ? Math.round((report.overview.netProfit / report.overview.totalRevenue) * 100)
      : 0;
    const prevProfitMargin = prevReport.overview.totalRevenue > 0
      ? Math.round((prevReport.overview.netProfit / prevReport.overview.totalRevenue) * 100)
      : 0;

    const userGrowth = report.overview.totalUsers > 0
      ? Math.round((report.overview.newUsers / report.overview.totalUsers) * 100)
      : 0;
    const churnRate = report.overview.totalUsers > 0
      ? Math.round((report.overview.churnedUsers / report.overview.totalUsers) * 100)
      : 0;

    const metrics = {
      profitMargin: {
        value: profitMargin,
        status: profitMargin >= 20 ? 'good' as const : profitMargin >= 0 ? 'warning' as const : 'critical' as const,
      },
      userGrowth: {
        value: userGrowth,
        status: userGrowth >= 15 ? 'good' as const : userGrowth >= 5 ? 'warning' as const : 'critical' as const,
      },
      kycRate: {
        value: report.userMetrics.kycRate,
        status: report.userMetrics.kycRate >= 60 ? 'good' as const : report.userMetrics.kycRate >= 30 ? 'warning' as const : 'critical' as const,
      },
      netDeposits: {
        value: report.userMetrics.netDeposits,
        status: report.userMetrics.netDeposits > 0 ? 'good' as const : report.userMetrics.netDeposits === 0 ? 'warning' as const : 'critical' as const,
      },
      churnRate: {
        value: churnRate,
        status: churnRate <= 5 ? 'good' as const : churnRate <= 15 ? 'warning' as const : 'critical' as const,
      },
      revenueTrend: {
        value: report.monthOverMonth.revenueChange,
        status: report.monthOverMonth.revenueChange > 0 ? 'good' as const : report.monthOverMonth.revenueChange >= -10 ? 'warning' as const : 'critical' as const,
      },
    };

    const statusValues = Object.values(metrics).map(m =>
      m.status === 'good' ? 3 : m.status === 'warning' ? 1 : 0
    );
    const healthScore = Math.round((statusValues.reduce((a, b) => a + b, 0) / (statusValues.length * 3)) * 100);

    const healthLabel: 'good' | 'fair' | 'needs_attention' | 'critical' =
      healthScore >= 70 ? 'good' : healthScore >= 50 ? 'fair' : healthScore >= 25 ? 'needs_attention' : 'critical';

    const healthScorePrev = prevReport.overview.totalRevenue > 0 ? healthScore - 5 : healthScore; // approximate
    const healthChange: 'improving' | 'stable' | 'deteriorating' =
      healthScore > healthScorePrev + 5 ? 'improving' :
      healthScore < healthScorePrev - 5 ? 'deteriorating' : 'stable';

    const warnings: string[] = [];
    const recommendations: string[] = [];

    if (profitMargin < 0) {
      warnings.push(`Negative profit margin (${profitMargin}%) — platform is losing money on stakes.`);
      recommendations.push('Review payout multipliers and commission structure to restore profitability.');
    }
    if (churnRate > 15) {
      warnings.push(`High churn rate (${churnRate}%) — users are leaving faster than ideal.`);
      recommendations.push('Launch retention campaigns: re-engage dormant users with bonuses.');
    }
    if (report.userMetrics.kycRate < 30) {
      warnings.push(`Low KYC completion rate (${report.userMetrics.kycRate}%) — most users are unverified.`);
      recommendations.push('Incentivize KYC completion with deposit bonuses or higher stake limits.');
    }
    if (report.userMetrics.netDeposits <= 0) {
      warnings.push(`Net deposits are ${report.userMetrics.netDeposits <= 0 ? 'zero or negative' : '₦' + report.userMetrics.netDeposits.toLocaleString()} — withdrawals exceed deposits.`);
      recommendations.push('Run deposit promotions and evaluate withdrawal patterns for abuse.');
    }
    if (report.monthOverMonth.revenueChange < -10) {
      warnings.push(`Revenue declining ${report.monthOverMonth.revenueChange}% month-over-month.`);
      recommendations.push('Analyze which sports/leagues are underperforming and adjust pod curation strategy.');
    }
    if (userGrowth < 5) {
      warnings.push(`Low user growth (${userGrowth}%) — not enough new users joining.`);
      recommendations.push('Boost acquisition through referral incentives and marketing campaigns.');
    }

    const previousHealthScore = await this.getPreviousHealthScore();

    return {
      timestamp: new Date().toISOString(),
      healthScore,
      healthLabel,
      metrics,
      warnings,
      recommendations,
      previousHealthScore,
      healthChange,
    };
  }

  private async getPreviousHealthScore(): Promise<number> {
    try {
      const report = await this.generateReport(60);
      const profitMargin = report.overview.totalRevenue > 0
        ? Math.round((report.overview.netProfit / report.overview.totalRevenue) * 100) : 0;
      const userGrowth = report.overview.totalUsers > 0
        ? Math.round((report.overview.newUsers / report.overview.totalUsers) * 100) : 0;
      const churnRate = report.overview.totalUsers > 0
        ? Math.round((report.overview.churnedUsers / report.overview.totalUsers) * 100) : 0;

      let score = 0;
      score += profitMargin >= 20 ? 3 : profitMargin >= 0 ? 1 : 0;
      score += userGrowth >= 15 ? 3 : userGrowth >= 5 ? 1 : 0;
      score += report.userMetrics.kycRate >= 60 ? 3 : report.userMetrics.kycRate >= 30 ? 1 : 0;
      score += report.userMetrics.netDeposits > 0 ? 3 : report.userMetrics.netDeposits === 0 ? 1 : 0;
      score += churnRate <= 5 ? 3 : churnRate <= 15 ? 1 : 0;
      score += report.monthOverMonth.revenueChange > 0 ? 3 : report.monthOverMonth.revenueChange >= -10 ? 1 : 0;
      return Math.round((score / 18) * 100);
    } catch {
      return 50;
    }
  }

  async notifyT4Advisory(advisory: T4Advisory) {
    if (advisory.healthLabel === 'critical' || advisory.healthLabel === 'needs_attention') {
      const title = `T4 Financial Advisory: ${advisory.healthLabel.toUpperCase()}`;
      const message = `Health score: ${advisory.healthScore}/100. Issues: ${advisory.warnings.slice(0, 2).join('; ')}`;
      const admins = await UserModel.find({ role: 'admin' }).select('_id').lean();
      for (const admin of admins) {
        await createInAppNotification(admin._id.toString(), 'system', title, message).catch(() => {});
      }
    }
  }
}

export const aiBiService = new AIBIService();

