// Risk & trust scoring (Phase 2.1) — transparent weighted-sum fusion.
//
// MVP is a deliberately explainable weighted sum (doc 02, Capability B): each
// signal contributes `weight × confidence` to a 0..100 risk score (capped at
// 100); trust is the inverse. The action comes from two thresholds. Weights and
// thresholds are read from the per-project SecurityRule.scoring (fail-open to the
// defaults below), so detection sensitivity is tunable per tenant without code or
// model changes. A learned fusion (LightGBM + SHAP attribution) is the
// V2/Enterprise upgrade behind this same `score()` interface.

const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

const clamp01 = (n) => {
    const x = Number(n);
    if (Number.isNaN(x)) return 0;
    return x < 0 ? 0 : x > 1 ? 1 : x;
};

// Contribution of each detector at confidence = 1.0, on the 0..100 scale.
// Authoritative detectors (xss, sqli) reach the block threshold on their own;
// weaker/heuristic signals need corroboration to cross it.
export const DEFAULT_WEIGHTS = Object.freeze({
    xss: 100,
    sqli: 100,
    nosqli: 90,
    ssrf: 90,
    "jwt-abuse": 80,
    "prompt-injection": 70,
    reputation: 60,
    "impossible-travel": 70,
    default: 50,
});

export const DEFAULT_THRESHOLDS = Object.freeze({
    blockThreshold: 70,
    challengeThreshold: 40,
});

/**
 * Fuse detection signals into a graduated decision.
 *
 * @param {import("./signal.js").Signal[]} signals
 * @param {{weights?: Object, blockThreshold?: number, challengeThreshold?: number}} [policy]
 * @returns {{riskScore:number, trustScore:number, action:"allow"|"challenge"|"block", topReasons:Array}}
 */
export function score(signals = [], policy = {}) {
    const weights = { ...DEFAULT_WEIGHTS, ...(policy.weights || {}) };
    const blockThreshold = num(policy.blockThreshold, DEFAULT_THRESHOLDS.blockThreshold);
    const challengeThreshold = num(policy.challengeThreshold, DEFAULT_THRESHOLDS.challengeThreshold);

    const contributions = [];
    let raw = 0;
    for (const s of signals || []) {
        const weight = num(weights[s.name], weights.default);
        const contribution = weight * clamp01(s.confidence);
        if (contribution <= 0) continue;
        raw += contribution;
        contributions.push({
            name: s.name,
            contribution: Math.round(contribution),
            confidence: clamp01(s.confidence),
            owasp: s.owasp ?? null,
            mitre: s.mitre ?? null,
            evidence: s.evidence ?? null,
        });
    }

    const riskScore = Math.min(100, Math.round(raw));
    const trustScore = 100 - riskScore;
    const action =
        riskScore >= blockThreshold ? "block" : riskScore >= challengeThreshold ? "challenge" : "allow";

    // Explainability: strongest contributors first (this is the "why was I
    // blocked" trail surfaced to the client and analyst UI).
    const topReasons = contributions.sort((a, b) => b.contribution - a.contribution).slice(0, 5);

    return { riskScore, trustScore, action, topReasons };
}
