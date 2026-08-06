import Redis from "ioredis";
import { redis } from "../app.js";
import { AlertRule } from "../models/alertrule.model.js";

// Alert-rule loader (Phase 3.6). The alert worker evaluates rules off the hot
// path, but still once per threat event — so rules live in an in-process L1 cache
// keyed by ORGANIZATION (all enabled rules for the org; the worker filters by
// project in-memory). Freshness comes from Redis pub/sub: a rule write publishes
// the organizationId on `alerts:invalidate` and every process drops that L1 entry
// (cross-process hot-reload, no restart). Mirrors utils/detectionRules.js.
const L1_TTL_MS = Number(process.env.ALERT_RULES_TTL_MS ?? 300_000); // 5 min backstop
const ALERTS_CHANNEL = "alerts:invalidate";

const l1 = new Map(); // organizationId -> { rules, expiresAt }

let subscriber;
function ensureSubscriber() {
    if (subscriber) return;
    try {
        subscriber = new Redis(process.env.REDIS_URL || undefined);
        subscriber.on("error", (e) => console.error("[alertRules] sub redis error:", e?.message || e));
        subscriber.on("message", (channel, message) => {
            if (channel !== ALERTS_CHANNEL) return;
            if (message === "*") l1.clear();
            else l1.delete(message);
        });
        subscriber.subscribe(ALERTS_CHANNEL).catch((e) =>
            console.error("[alertRules] subscribe failed:", e?.message || e)
        );
    } catch (e) {
        console.error("[alertRules] subscriber init failed:", e?.message || e);
    }
}

/**
 * Load an org's enabled alert rules, cached in-process. Returns [] for no org /
 * no rules. Throws only on a Mongo error (the worker treats that as "no rules").
 */
export async function loadAlertRules(organizationId) {
    if (!organizationId) return [];
    ensureSubscriber();
    const key = String(organizationId);

    const hit = l1.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.rules;

    const docs = await AlertRule.find({ organizationId, enabled: true }).lean();
    const rules = docs.map((d) => ({
        _id: d._id,
        name: d.name,
        projectId: d.projectId || null,
        severity: d.severity || "warning",
        conditions: d.conditions,
        channelIds: (d.channelIds || []).map(String),
        dedupBy: d.dedupBy || "fingerprint",
        dedupWindowSec: d.dedupWindowSec ?? 300,
        snoozedUntil: d.snoozedUntil || null,
    }));
    l1.set(key, { rules, expiresAt: Date.now() + L1_TTL_MS });
    return rules;
}

/** Invalidate an org's alert rules everywhere: drop local L1 + publish to peers. */
export async function invalidateAlertRules(organizationId) {
    if (!organizationId) return;
    const key = String(organizationId);
    l1.delete(key);
    try {
        await redis.publish(ALERTS_CHANNEL, key);
    } catch (e) {
        console.error("[alertRules] publish invalidate failed:", e?.message || e);
    }
}

// Test/util hook: clear the whole L1 cache in-process.
export function _clearAlertRuleCache() {
    l1.clear();
}
