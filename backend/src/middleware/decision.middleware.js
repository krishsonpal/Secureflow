import { APIResponse } from "../utils/apiresponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { loadSecurityRule } from "../utils/securityRule.js";
import { logUsageAsync } from "../utils/logusage.js";
import { incSecurityEvent } from "../observability/metrics.js";
import { score } from "../detection/scoring.js";

// Map the top blocking signal to the APIUsage status used for analytics/rollups.
// Falls back to the generic "blocked" bucket for detectors that don't have a
// dedicated status yet (dedicated statuses are added with the detectors in 2.3).
const STATUS_FOR_SIGNAL = {
    xss: "xss",
};

/**
 * Decision stage (Phase 2.1). Runs AFTER the detector middlewares (which now
 * emit signals onto `req.signals`) and after identity resolution (checkuserlimit
 * sets `req.projectId`). It fuses the signals via the scoring engine using the
 * project's policy, records the decision on the request + event, and enforces the
 * graduated action:
 *   - allow / challenge → continue (no step-up infra yet; the controller logs its
 *     own terminal status). The decision is left on `req.decision` for downstream use.
 *   - block            → 403 with the explainable topReasons.
 *
 * Fails OPEN: a scoring error must never block legitimate traffic.
 */
export const decisionMiddleware = asyncHandler(async (req, res, next) => {
    const signals = req.signals || [];
    if (signals.length === 0) return next(); // fast path: no detector fired

    let decision;
    try {
        const rule = await loadSecurityRule(req.projectId);
        decision = score(signals, rule.scoring);
    } catch (err) {
        console.error("[decision] scoring failed, failing open:", err?.message || err);
        return next();
    }

    req.decision = decision;
    res.setHeader("X-SecureFlow-Risk", String(decision.riskScore));

    if (decision.action !== "block") {
        return next();
    }

    const topSignal = decision.topReasons[0]?.name || "unknown";
    const status = STATUS_FOR_SIGNAL[topSignal] || "blocked";
    // Preserves the existing `xss_blocked` Prometheus series; new detectors get
    // their own `<signal>_blocked` series for free.
    incSecurityEvent(`${topSignal}_blocked`);

    const reasonList = decision.topReasons.map((r) => r.name).join(", ");
    await logUsageAsync(
        req.body?.apiKey,
        req.body?.fingerprint,
        status,
        `Blocked (risk ${decision.riskScore}): ${reasonList}`,
        { riskScore: decision.riskScore, action: decision.action, topSignal }
    );

    return res.status(403).json(
        new APIResponse(
            403,
            { blocked: true, riskScore: decision.riskScore, topReasons: decision.topReasons },
            "Request blocked by SecureFlow"
        )
    );
});
