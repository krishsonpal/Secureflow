import { APIResponse } from "../utils/apiresponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { loadSecurityRule } from "../utils/securityRule.js";
import { loadRules } from "../utils/detectionRules.js";
import { logUsageAsync } from "../utils/logusage.js";
import { incSecurityEvent } from "../observability/metrics.js";
import { score } from "../detection/scoring.js";
import { evaluateRules } from "../detection/ruleEngine.js";
import { addSignal } from "../detection/signal.js";
import { lookupReputation } from "../detection/reputation.js";
import { detectImpossibleTravel } from "../detection/detectors/impossibleTravel.js";
import { resolveGeo } from "../detection/geo.js";

// Map the top blocking signal to the APIUsage status used for analytics/rollups.
// Each detector has a dedicated status so the dashboard can categorize blocks;
// anything unmapped (e.g. a rule-only block) falls back to the generic "blocked".
const STATUS_FOR_SIGNAL = {
    xss: "xss",
    sqli: "sqli",
    nosqli: "nosqli",
    ssrf: "ssrf",
    "jwt-abuse": "jwt-abuse",
    "prompt-injection": "prompt-injection",
    reputation: "reputation",
    "impossible-travel": "impossible-travel",
};

/**
 * Phase 2.6 — identity/IP-based signals resolved on the decision path (they need
 * both req.ip AND the identity that `checkuserlimit` resolves, neither of which
 * is available in the earlier `runDetectors` stage). Each is independently
 * fail-open: a lookup error is logged and skipped, never blocks the request.
 */
async function addThreatIntelSignals(req) {
    const ip = req.ip;

    // Reputation: known-bad IP (external feeds) or a repeat offender (local counts).
    try {
        const rep = await lookupReputation({ ip, fingerprint: req.body?.fingerprint });
        if (rep && rep.confidence > 0) {
            addSignal(req, {
                name: "reputation",
                confidence: rep.confidence,
                evidence: rep.evidence,
                owasp: "API#—",
                mitre: "T1595",
            });
        }
    } catch (err) {
        console.error("[decision] reputation lookup failed (skipped):", err?.message || err);
    }

    // Impossible travel: same identity from geographically impossible locations.
    // Requires a resolvable geo (GeoLite2 configured) AND a server-trusted
    // identity (the API-key hash) — skip cleanly otherwise.
    try {
        const geo = resolveGeo(ip);
        if (geo && req.apiKeyHash) {
            const it = await detectImpossibleTravel({ identity: req.apiKeyHash, geo });
            if (it && it.confidence > 0) {
                addSignal(req, {
                    name: "impossible-travel",
                    confidence: it.confidence,
                    evidence: it.evidence,
                    owasp: "API#2",
                    mitre: "T1078",
                });
            }
        }
    } catch (err) {
        console.error("[decision] impossible-travel check failed (skipped):", err?.message || err);
    }
}

// Build the evaluation context that rules run against: the fused score, the
// individual detector signals (name -> confidence), and request features.
function buildContext(req, decision) {
    const signals = {};
    for (const s of req.signals || []) signals[s.name] = s.confidence;
    return {
        riskScore: decision.riskScore,
        trustScore: decision.trustScore,
        scoreAction: decision.action,
        signals,
        signalNames: (req.signals || []).map((s) => s.name),
        method: req.method,
        path: req.originalUrl || req.path || "",
        ip: req.ip || "",
        projectId: req.projectId ? String(req.projectId) : "",
        organizationId: req.organizationId ? String(req.organizationId) : "",
    };
}

/**
 * Decision stage (Phase 2.1 + 2.2). Runs AFTER the detector middlewares (which
 * emit signals onto `req.signals`) and identity resolution. It:
 *   1. fuses the signals via the weighted-sum scorer with the project's policy,
 *   2. evaluates the project's declarative rules against the fused context —
 *      a matching enforcing rule (allow/challenge/block) OVERRIDES the scored
 *      action (allowlist bypass, forced block); "log" records a match only,
 *   3. records the decision on the request + event and enforces the final action.
 *
 * Fails OPEN throughout: a scoring or rule-load error must never block traffic.
 */
export const decisionMiddleware = asyncHandler(async (req, res, next) => {
    // Phase 2.6: resolve identity/IP-based signals FIRST, so a benign-payload
    // request from a known-bad IP or an impossible geo is still scored below.
    await addThreatIntelSignals(req);

    const signals = req.signals || [];

    let rules = [];
    try {
        rules = await loadRules(req.projectId);
    } catch (err) {
        console.error("[decision] rule load failed, ignoring rules:", err?.message || err);
        rules = [];
    }

    // Fast path: no detector fired AND no rules to evaluate.
    if (signals.length === 0 && rules.length === 0) return next();

    let decision;
    try {
        const rule = await loadSecurityRule(req.projectId);
        decision = score(signals, rule.scoring);
    } catch (err) {
        console.error("[decision] scoring failed, failing open:", err?.message || err);
        return next();
    }

    // Rule engine: highest-priority matching enforcing rule overrides the score.
    const ruleResult = evaluateRules(rules, buildContext(req, decision));
    const ruleReasons = ruleResult.matched.map((m) => ({
        name: `rule:${m.name}`,
        action: m.action,
        priority: m.priority,
    }));
    const finalAction = ruleResult.action || decision.action;

    const topReasons = [...ruleReasons, ...decision.topReasons];
    req.decision = { ...decision, finalAction, matchedRules: ruleResult.matched, topReasons };
    res.setHeader("X-SecureFlow-Risk", String(decision.riskScore));
    res.setHeader("X-SecureFlow-Action", finalAction);

    if (finalAction !== "block") {
        // allow (incl. a rule overriding a would-be block) / challenge → continue.
        return next();
    }

    const topSignal = decision.topReasons[0]?.name || null;
    const forcedByRule = ruleResult.action === "block";
    const status = topSignal ? STATUS_FOR_SIGNAL[topSignal] || "blocked" : "blocked";
    // Preserves the existing `<signal>_blocked` Prometheus series; a rule-only
    // block (no signal) is counted under `rule_blocked`.
    incSecurityEvent(topSignal ? `${topSignal}_blocked` : "rule_blocked");

    const reasonList = topReasons.map((r) => r.name).join(", ");
    await logUsageAsync(
        req.body?.apiKey,
        req.body?.fingerprint,
        status,
        `Blocked (risk ${decision.riskScore}${forcedByRule ? ", rule" : ""}): ${reasonList}`,
        {
            riskScore: decision.riskScore,
            action: "block",
            topSignal: topSignal || (forcedByRule ? `rule:${ruleResult.matched[0]?.name}` : "unknown"),
            ip: req.ip, // Phase 2.6: carried to the threat-intel worker for fingerprinting
        }
    );

    return res.status(403).json(
        new APIResponse(
            403,
            { blocked: true, riskScore: decision.riskScore, topReasons },
            "Request blocked by SecureFlow"
        )
    );
});
