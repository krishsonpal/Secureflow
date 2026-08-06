import Redis from "ioredis";
import { redis } from "../app.js";
import { DetectionRule } from "../models/detectionrule.model.js";

// Rule loader (Phase 2.2). Rules are evaluated INLINE on the hot path, so they
// live in an in-process L1 cache (a plain Map) for microsecond reads. Freshness
// comes from Redis pub/sub: an admin write publishes the projectId on
// `rules:invalidate`, and every process's subscriber drops that L1 entry
// immediately (cross-process hot-reload, no restart). A short TTL is a backstop.
const L1_TTL_MS = 300_000; // 5 min
const RULES_CHANNEL = "rules:invalidate";

const l1 = new Map(); // projectId -> { rules, expiresAt }

let subscriber;
function ensureSubscriber() {
    if (subscriber) return;
    try {
        // pub/sub needs its own connection (a subscribed ioredis client can't run
        // normal commands).
        subscriber = new Redis(process.env.REDIS_URL || undefined);
        subscriber.on("error", (e) => console.error("[detectionRules] sub redis error:", e?.message || e));
        subscriber.on("message", (channel, message) => {
            if (channel !== RULES_CHANNEL) return;
            if (message === "*") l1.clear();
            else l1.delete(message);
        });
        subscriber.subscribe(RULES_CHANNEL).catch((e) =>
            console.error("[detectionRules] subscribe failed:", e?.message || e)
        );
    } catch (e) {
        console.error("[detectionRules] subscriber init failed:", e?.message || e);
    }
}

/**
 * Load a project's enabled rules (priority desc), cached in-process. Returns []
 * for no project / no rules. Throws only on a Mongo error, which the decision
 * middleware treats as fail-open (no rules).
 */
export async function loadRules(projectId) {
    if (!projectId) return [];
    ensureSubscriber();
    const key = String(projectId);

    const hit = l1.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.rules;

    const docs = await DetectionRule.find({ projectId, enabled: true })
        .sort({ priority: -1 })
        .lean();
    const rules = docs.map((d) => ({
        name: d.name,
        priority: d.priority ?? 0,
        enabled: d.enabled !== false,
        action: d.action,
        conditions: d.conditions,
    }));
    l1.set(key, { rules, expiresAt: Date.now() + L1_TTL_MS });
    return rules;
}

/** Invalidate a project's rules everywhere: drop local L1 + publish to peers. */
export async function invalidateRules(projectId) {
    if (!projectId) return;
    const key = String(projectId);
    l1.delete(key);
    try {
        await redis.publish(RULES_CHANNEL, key);
    } catch (e) {
        console.error("[detectionRules] publish invalidate failed:", e?.message || e);
    }
}

// Test/util hook: clear the whole L1 cache in-process.
export function _clearRuleCache() {
    l1.clear();
}
