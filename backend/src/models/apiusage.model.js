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
        enum: ["success", "failed", "locked", "rate-limited", "xss", "session-theft", "bot"],
        default: "success"
    },
    message: String
}, { timestamps: true });

// Analytics hot paths on the (unindexed until now) usage collection:
//  - countDocuments({ projectId, status })   → prefix of the compound index
//  - find({ projectId }).sort({ createdAt:-1 }).limit(50) → project + createdAt index
apiUsageSchema.index({ projectId: 1, status: 1, createdAt: -1 });
apiUsageSchema.index({ projectId: 1, createdAt: -1 });

export const APIUsage = mongoose.model("APIUsage", apiUsageSchema);