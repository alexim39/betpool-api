import 'dotenv/config';
import app from "./app";
import { aiAutomationService } from './modules/ai/ai-automation.service';
import { aiRiskService } from './modules/ai/ai-risk.service';
import { aiBiService } from './modules/ai/ai-bi.service';

// set environment configs
//dotenv.config({ path: './.env' });
const port: any = process.env.PORT || 8383;

app.listen(port, () => {
    console.log(`Express server listening on port ${port}`);
    // Start Ora automation cycle (every 6 hours) — settlement only (curation disabled)
    if (process.env.ORA_AUTOMATION !== 'disabled') {
        aiAutomationService.start();
        console.log('[Ora Automation] Background settlement cycle started — every 6 hours');
    }
    // Start risk auto-escalation scheduler (every 15 minutes)
    if (process.env.RISK_AUTO_ESCALATION !== 'disabled') {
        aiRiskService.startScheduler();
        console.log('[Risk Management] Auto-escalation scheduler started');
    }
    // Run initial T4 financial advisory check
    if (process.env.T4_ADVISORY !== 'disabled') {
        aiBiService.generateT4Advisory().then(advisory => {
            console.log(`[T4 Advisory] Health score: ${advisory.healthScore}/100 — ${advisory.healthLabel}`);
            aiBiService.notifyT4Advisory(advisory);
        }).catch(e => console.error('[T4 Advisory] Initial check failed:', e));
        // Schedule T4 re-check every 6 hours
        setInterval(() => {
            aiBiService.generateT4Advisory().then(advisory => {
                console.log(`[T4 Advisory] Health score: ${advisory.healthScore}/100 — ${advisory.healthLabel}`);
                aiBiService.notifyT4Advisory(advisory);
            }).catch(e => console.error('[T4 Advisory] Check failed:', e));
        }, 6 * 60 * 60 * 1000);
        console.log('[T4 Advisory] Background check started — every 6 hours');
    }
})
