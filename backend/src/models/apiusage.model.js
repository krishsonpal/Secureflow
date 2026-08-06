import mongoose, { Schema } from "mongoose";

const apiUsageSchema = new Schema({
    apiKey: {
        type: Schema.Types.ObjectId,
        ref: "ApiKey",
        required: [true, "Api key is required"]
    },
    projectId: {
        type: Schema.Types.ObjectId,
        ref: "Project"
    },
    organizationId: {
        type: Schema.Types.ObjectId,
        ref: "Organization",
        index: true
    },
    fingerprint: String,
    status: {
        type: String,
        // "blocked" (Phase 2.1) = generic decision-engine block (e.g. rule-only).
        // sqli/nosqli/ssrf/jwt-abuse (Phase 2.3) are the per-detector block buckets.
        enum: [
            "success", "failed", "locked", "rate-limited", "xss", "session-theft", "bot",
            "blocked", "sqli", "nosqli", "ssrf", "jwt-abuse", "prompt-injection",
            // Phase 2.6 — threat-intel / account-takeover signals.
            "reputation", "impossible-travel",
        ],
        default: "success"
    },
    message: String,
    // Phase 2.1 — decision-engine outcome. Present on scored requests; absent on
    // legacy/plain events. `topSignal` is the highest-contributing detector.
    riskScore: { type: Number },
    action: { type: String, enum: ["allow", "challenge", "block"] },
    topSignal: { type: String },
    // Phase 3.10 (Dashboard V2) — geo + client IP, resolved off the hot path by
    // the usage worker. `country` (ISO-2) powers the Attack Map; it stays null
    // until GeoLite2 is configured. `ip` is stored per IP_STORE_MODE (truncated
    // /24 by default → anonymized host, subnet grouping preserved); it aids the
    // Threat Explorer only and can be null (mode=none / private / unparseable).
    country: { type: String },
    ip: { type: String }
}, { timestamps: true });

// Analytics hot paths on the (unindexed until now) usage collection:
//  - countDocuments({ projectId, status })   → prefix of the compound index
//  - find({ projectId }).sort({ createdAt:-1 }).limit(50) → project + createdAt index
apiUsageSchema.index({ projectId: 1, status: 1, createdAt: -1 });
apiUsageSchema.index({ projectId: 1, createdAt: -1 });
// Phase 3.1 — tenant-scoped analytics (org-wide, across a tenant's projects).
// Supports the org+project filtered reads the isolation layer (3.3) produces.
apiUsageSchema.index({ organizationId: 1, projectId: 1, status: 1, createdAt: -1 });
// Phase 3.10 — geo aggregation for the Attack Map (group by country over a
// tenant's project, threat statuses within a recent window).
apiUsageSchema.index({ organizationId: 1, projectId: 1, country: 1 });

export const APIUsage = mongoose.model("APIUsage", apiUsageSchema);