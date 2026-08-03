import 'dotenv/config';
import app from "./app";
import { aiAutomationService } from './modules/ai/ai-automation.service';
import { aiRiskService } from './modules/ai/ai-risk.service';
import { aiBiService } from './modules/ai/ai-bi.service';
import { aiGamesService } from './modules/ai/ai-games.service';
import { walletService } from './services/wallet.service';
import { aiDigestService } from './modules/digest/ai-digest.service';
import { logger } from './services/logger.service';

// set environment configs
//dotenv.config({ path: './.env' });
const port: any = process.env.PORT || 8383;

app.listen(port, () => {
    logger.info(`Express server listening on port ${port}`);
    // Populate Games Today board on boot so /games is never empty after a restart
    aiGamesService.analyzeToday()
        .then(r => logger.info(`[Games Today] Boot analysis: ${r.analyzed} analyzed / ${r.fixturesFound} fixtures / ${r.errors.length} errors`))
        .catch(e => logger.error('[Games Today] Boot analysis failed', e));
    // Start Ora automation cycle (every 2 hours) — curation, pod creation, bet manager
    if (process.env.ORA_AUTOMATION !== 'disabled') {
        aiAutomationService.start(2 * 60 * 60 * 1000);
        logger.info('[Ora Automation] Background curation + publishing cycle started — every 2 hours');
    }
    // Start risk auto-escalation scheduler (every 15 minutes)
    if (process.env.RISK_AUTO_ESCALATION !== 'disabled') {
        aiRiskService.startScheduler();
        logger.info('[Risk Management] Auto-escalation scheduler started');
    }
    // Start Games Today live match-status watcher (every 5 minutes)
    if (process.env.MATCH_STATUS_WATCHER !== 'disabled') {
        aiGamesService.startStatusWatcher();
        logger.info('[Games Status] Live match-status watcher started — every 5 minutes');
    }
    // Start Daily AI Briefing scheduler (daily at configured hour)
    if (process.env.DAILY_DIGEST !== 'disabled') {
        aiDigestService.start();
        logger.info('[Daily Digest] Background scheduler started');
    }
    // Run initial T4 financial advisory check
    if (process.env.T4_ADVISORY !== 'disabled') {
        aiBiService.generateT4Advisory().then(advisory => {
            logger.info(`[T4 Advisory] Health score: ${advisory.healthScore}/100 — ${advisory.healthLabel}`);
            aiBiService.notifyT4Advisory(advisory);
        }).catch(e => logger.error('[T4 Advisory] Initial check failed', e));
        // Schedule T4 re-check every 6 hours
        setInterval(() => {
            aiBiService.generateT4Advisory().then(advisory => {
                logger.info(`[T4 Advisory] Health score: ${advisory.healthScore}/100 — ${advisory.healthLabel}`);
                aiBiService.notifyT4Advisory(advisory);
            }).catch(e => logger.error('[T4 Advisory] Check failed', e));
        }, 6 * 60 * 60 * 1000);
        logger.info('[T4 Advisory] Background check started — every 6 hours');
    }
    // Start withdrawal reconciliation (every 5 minutes)
    if (process.env.WITHDRAWAL_RECONCILIATION !== 'disabled') {
        setInterval(async () => {
            try {
                await walletService.reconcileStuckWithdrawals();
            } catch (e) {
                logger.error('[Withdrawal Reconciliation] Error', e);
            }
        }, 5 * 60 * 1000);
        logger.info('[Withdrawal Reconciliation] Background check started — every 5 minutes');
    }
})
