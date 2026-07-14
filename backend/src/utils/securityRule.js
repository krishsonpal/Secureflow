import { redis } from "../app.js";
import { SecurityRule } from "../models/securityrule.model.js";

const RULE_CACHE_TTL_SECONDS = 300;

// Defaults mirror the SecurityRule schema. Used when a project has no rule row,
// when projectId is unknown, or when Redis/Mongo is unreachable (fail-open).
export const DEFAULT_RULE = Object.freeze({
    rateLimit: 100,
    rateWindow: 60,
    otpLimit: 5,
    blockBots: true,
    banDuration: 2000,
    whitelistips: [],
});

function pickRule(doc) {
    if (!doc) return { ...DEFAULT_RULE };
    return {
        rateLimit: doc.rateLimit ?? DEFAULT_RULE.rateLimit,
        rateWindow: doc.rateWindow ?? DEFAULT_RULE.rateWindow,
        otpLimit: doc.otpLimit ?? DEFAULT_RULE.otpLimit,
        blockBots: doc.blockBots ?? DEFAULT_RULE.blockBots,
        banDuration: doc.banDuration ?? DEFAULT_RULE.banDuration,
        whitelistips: Array.isArray(doc.whitelistips) ? doc.whitelistips : DEFAULT_RULE.whitelistips,
    };
}

/**
 * Load the SecurityRule for a project, cached in Redis (300s) like API-key
 * credits. Fails OPEN to DEFAULT_RULE on any error or missing config, so a
 * store blip never blocks the hot path.
 *
 * @param {string|null} projectId
 * @returns {Promise<typeof DEFAULT_RULE>}
 */
export async function loadSecurityRule(projectId) {
    if (!projectId) return { ...DEFAULT_RULE };

    const cacheKey = `secrule:${projectId}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);

        const doc = await SecurityRule.findOne({ projectId });
        const rule = pickRule(doc);
        await redis.set(cacheKey, JSON.stringify(rule), "EX", RULE_CACHE_TTL_SECONDS);
        return rule;
    } catch (err) {
        console.error("[securityRule] load failed, using defaults:", err?.message || err);
        return { ...DEFAULT_RULE };
    }
}

/** Invalidate the cached rule for a project (call after an admin update). */
export async function invalidateSecurityRule(projectId) {
    if (!projectId) return;
    try {
        await redis.del(`secrule:${projectId}`);
    } catch (err) {
        console.error("[securityRule] cache invalidation failed:", err?.message || err);
    }
}
