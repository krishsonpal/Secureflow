import mongoose, { Schema } from "mongoose";

// AlertChannel (Phase 3.6) — a reusable notification destination, org-scoped.
// Alert rules reference channels by id so a destination is configured once and
// used across rules (doc 09 "channel adapters"). `config` shape depends on type:
//   email   → { email }
//   slack   → { slackWebhookUrl }        (Slack incoming webhook)
//   webhook → { url, secret? }           (generic POST; secret → HMAC signature)
const alertChannelSchema = new Schema(
    {
        organizationId: {
            type: Schema.Types.ObjectId,
            ref: "Organization",
            required: true,
            index: true,
        },
        name: { type: String, required: true, trim: true },
        type: { type: String, enum: ["email", "slack", "webhook"], required: true },
        config: { type: Schema.Types.Mixed, default: {} },
        enabled: { type: Boolean, default: true },
    },
    { timestamps: true }
);

// One channel name per org.
alertChannelSchema.index({ organizationId: 1, name: 1 }, { unique: true });

export const AlertChannel = mongoose.model("AlertChannel", alertChannelSchema);
