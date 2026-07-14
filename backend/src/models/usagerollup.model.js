import mongoose, { Schema } from "mongoose";

// Per-project cumulative usage counters. Maintained incrementally by the usage
// worker as it drains stream:usage, so the dashboard reads O(1) totals instead
// of re-scanning the unbounded APIUsage collection with countDocuments on every
// request (Part 1.8). `byStatus` keeps a breakdown for any status without a
// schema change.
const usageRollupSchema = new Schema(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: "Project",
            required: true,
            unique: true,   // one rollup doc per project (also the lookup index)
        },
        organizationId: {
            type: Schema.Types.ObjectId,
            ref: "Organization",
            index: true,
        },
        totalRequests: { type: Number, default: 0 },
        threatsBlocked: { type: Number, default: 0 },
        rateLimited: { type: Number, default: 0 },
        // Full per-status counts, e.g. { success: 10, xss: 2, "rate-limited": 1 }.
        byStatus: { type: Map, of: Number, default: {} },
        lastEventAt: { type: Date },
    },
    { timestamps: true }
);

// Statuses that count as a blocked threat (mirrors the dashboard's definition).
export const THREAT_STATUSES = ["failed", "locked", "xss", "session-theft", "bot"];

export const UsageRollup = mongoose.model("UsageRollup", usageRollupSchema);
