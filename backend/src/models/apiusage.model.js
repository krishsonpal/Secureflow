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
    fingerprint: String,
    status: {
        type: String,
        enum: ["success", "failed", "locked", "rate-limited", "xss", "session-theft", "bot"],
        default: "success"
    },
    message: String
}, { timestamps: true });

export const APIUsage = mongoose.model("APIUsage", apiUsageSchema);