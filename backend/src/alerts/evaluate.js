import { matchesRule } from "../detection/ruleEngine.js";
import { loadAlertRules } from "../utils/alertRules.js";
import { rateLimit } from "../utils/rateLimiter.js";
import { Alert } from "../models/alert.model.js";
import { AlertChannel } from "../models/alertchannel.model.js";
import { dispatch as defaultDispatch } from "./channels/index.js";

// Phase 3.7 — evaluate ONE threat event against an org's alert rules, off the hot
// path (called by the alert worker). For every matching rule:
//   1. upsert a grouped Alert (one open row per rule+groupValue; count++ on repeat)
//   2. gate NOTIFICATION on a Redis dedup window (rateLimit(key,1,window)) so a
//      burst becomes one notification + a rising count, not N notifications
//   3. dispatch to the rule's channels (fail-open)
// Grouping keeps the durable Alert accurate even while notifications are throttled.

const groupValue = (dedupBy, ctx) => {
    if (dedupBy === "ip") return ctx.ip || "none";
    if (dedupBy === "identity") return ctx.identity || ctx.fingerprint || ctx.ip || "none";
    return ctx.fingerprint || ctx.ip || "none"; // default: fingerprint
};

const pickContext = (ctx) => ({
    status: ctx.status, riskScore: ctx.riskScore, action: ctx.action,
    topSignal: ctx.topSignal, ip: ctx.ip, fingerprint: ctx.fingerprint,
});

async function defaultLoadChannels(organizationId, channelIds) {
    if (!channelIds?.length) return [];
    return AlertChannel.find({ organizationId, _id: { $in: channelIds }, enabled: true }).lean();
}

/**
 * @param event  { organizationId, projectId?, environmentId?, identity?, status, riskScore, action, topSignal, ip, fingerprint }
 * Injectables (loadChannels/dispatch/emit) let tests run without SMTP/HTTP.
 * @returns summary { matched, notified } for tests/logging.
 */
export async function evaluateEvent({ event, loadChannels = defaultLoadChannels, dispatch = defaultDispatch, emit } = {}) {
    const organizationId = event?.organizationId;
    if (!organizationId) return { matched: 0, notified: 0 };

    const rules = await loadAlertRules(organizationId);
    if (!rules.length) return { matched: 0, notified: 0 };

    const now = new Date();
    const ctx = {
        status: event.status,
        riskScore: event.riskScore != null && event.riskScore !== "" ? Number(event.riskScore) : 0,
        action: event.action || "",
        topSignal: event.topSignal || "",
        ip: event.ip || "",
        fingerprint: event.fingerprint || "",
        identity: event.identity || "",
        projectId: event.projectId ? String(event.projectId) : null,
        environmentId: event.environmentId || null,
    };

    let matched = 0, notified = 0;
    for (const rule of rules) {
        // Org-wide rule (projectId null) matches any project; else must match.
        if (rule.projectId && String(rule.projectId) !== ctx.projectId) continue;
        if (!matchesRule(rule.conditions, ctx)) continue;
        matched++;

        const dedupKey = `${rule._id}:${groupValue(rule.dedupBy, ctx)}`;
        const title = `${rule.name}: ${ctx.status}${ctx.topSignal ? ` (${ctx.topSignal})` : ""}`;

        // Durable grouped alert — always updated (count++), even when notification
        // is suppressed or the rule is snoozed. Groups onto the open/ack row;
        // a resolved row is left alone (a fresh match opens a new alert).
        const alert = await Alert.findOneAndUpdate(
            { organizationId, dedupKey, status: { $ne: "resolved" } },
            {
                $inc: { count: 1 },
                $set: { severity: rule.severity, lastSeenAt: now, projectId: ctx.projectId, alertRuleId: rule._id, context: pickContext(ctx), title },
                $setOnInsert: { firstSeenAt: now, status: "open" },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // Snooze: match + group, but never notify while snoozed.
        if (rule.snoozedUntil && new Date(rule.snoozedUntil) > now) continue;

        // Notification dedup window: only the first hit per window notifies.
        const first = (await rateLimit(`alert:dd:${dedupKey}`, 1, rule.dedupWindowSec || 300)).allowed;
        if (!first) continue;

        const channels = await loadChannels(organizationId, rule.channelIds);
        for (const ch of channels) {
            const r = await dispatch(ch, alert);
            if (!r?.ok) console.error(`[alert] channel "${ch?.name}" failed: ${r?.error}`);
        }
        if (emit && ctx.projectId) {
            try { emit(ctx.projectId, { type: "alert", severity: alert.severity, title: alert.title, id: String(alert._id) }); } catch { /* non-critical */ }
        }
        notified++;
    }
    return { matched, notified };
}
