import mongoose, { Schema } from "mongoose";

// Alert (Phase 3.6) — a fired, deduplicated/grouped alert record shown in the
// Alert Center. One open Alert per (rule, dedupKey): repeat matches within the
// rule's window bump `count`/`lastSeenAt` instead of creating a new row (the
// notification itself is suppressed by the Redis dedup window; this doc is the
// durable, groupable history + triage surface).
const alertSchema = new Schema(
    {
        organizationId: {
            type: Schema.Types.ObjectId,
            ref: "Organization",
            required: true,
            index: true,
        },
        projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null },
        alertRuleId: { type: Schema.Types.ObjectId, ref: "AlertRule", required: true },
        severity: { type: String, enum: ["info", "warning", "critical"], default: "warning" },
        status: { type: String, enum: ["open", "acknowledged", "resolved"], default: "open" },
        title: { type: String, default: "" },
        // Snapshot of the triggering event: { status, riskScore, action, topSignal, ip, fingerprint }.
        context: { type: Schema.Types.Mixed, default: {} },
        // Stable grouping key = `${ruleId}:${groupValue}` (severity is implicit in ruleId).
        dedupKey: { type: String, required: true, index: true },
        count: { type: Number, default: 1 },
        firstSeenAt: { type: Date, default: Date.now },
        lastSeenAt: { type: Date, default: Date.now },
        acknowledgedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
        acknowledgedAt: { type: Date, default: null },
        resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
        resolvedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// Alert Center list (open first, newest activity first).
alertSchema.index({ organizationId: 1, status: 1, lastSeenAt: -1 });
// Grouping lookup: the open alert for a dedup key.
alertSchema.index({ organizationId: 1, dedupKey: 1, status: 1 });

export const Alert = mongoose.model("Alert", alertSchema);
