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
        ],
        default: "success"
    },
    message: String,
    // Phase 2.1 — decision-engine outcome. Present on scored requests; absent on
    // legacy/plain events. `topSignal` is the highest-contributing detector.
    riskScore: { type: Number },
    action: { type: String, enum: ["allow", "challenge", "block"] },
    topSignal: { type: String }
}, { timestamps: true });

// Analytics hot paths on the (unindexed until now) usage collection:
//  - countDocuments({ projectId, status })   → prefix of the compound index
//  - find({ projectId }).sort({ createdAt:-1 }).limit(50) → project + createdAt index
apiUsageSchema.index({ projectId: 1, status: 1, createdAt: -1 });
apiUsageSchema.index({ projectId: 1, createdAt: -1 });

export const APIUsage = mongoose.model("APIUsage", apiUsageSchema);