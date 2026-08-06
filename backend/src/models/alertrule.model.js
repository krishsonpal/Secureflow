import mongoose, { Schema } from "mongoose";

// AlertRule (Phase 3.6) — "when a threat event matches these conditions, raise an
// alert of this severity and notify these channels". Reuses the SAME JSON
// condition grammar as DetectionRule (detection/ruleEngine.js): `conditions` is a
// { all|any: [...] } tree of { fact, operator, value } leaves, validated at write
// time (validateConditions) and evaluated safely (matchesRule) by the alert
// worker over the event context (status/riskScore/action/topSignal/ip/fingerprint).
//
// Evaluated OFF the hot path by the alert worker (3rd consumer group), never
// inline — so unlike DetectionRule there is no enforcing action, only notify.
const alertRuleSchema = new Schema(
    {
        organizationId: {
            type: Schema.Types.ObjectId,
            ref: "Organization",
            required: true,
            index: true,
        },
        // null → org-wide (matches events for any project in the org).
        projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null },
        name: { type: String, required: true, trim: true },
        enabled: { type: Boolean, default: true },
        severity: { type: String, enum: ["info", "warning", "critical"], default: "warning" },
        conditions: { type: Schema.Types.Mixed, required: true },
        channelIds: [{ type: Schema.Types.ObjectId, ref: "AlertChannel" }],
        // What identity groups repeated matches for dedup (see the worker).
        dedupBy: { type: String, enum: ["fingerprint", "ip", "identity"], default: "fingerprint" },
        // Suppression window: after a notify, repeats within this many seconds are
        // grouped (count++) instead of re-notifying. Env default DEDUP_WINDOW_SEC.
        dedupWindowSec: { type: Number, default: Number(process.env.ALERT_DEDUP_WINDOW_SEC ?? 300) },
        // If set and in the future, the rule matches but never notifies (snoozed).
        snoozedUntil: { type: Date, default: null },
    },
    { timestamps: true }
);

// The worker loads all enabled rules for an org, then filters by project in-memory.
alertRuleSchema.index({ organizationId: 1, enabled: 1 });

export const AlertRule = mongoose.model("AlertRule", alertRuleSchema);
