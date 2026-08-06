import mongoose, { Schema } from "mongoose";

// Threat-intel history (Phase 2.6). The durable record behind the Redis "hot"
// reputation store: one doc per attacking IP, maintained incrementally by the
// threat-intel worker as it drains stream:usage (the worker is the sole writer,
// same pattern as UsageRollup). Redis answers the fast decision-path lookup;
// this collection is the queryable history / audit trail.
const threatIntelSchema = new Schema(
    {
        ip: { type: String, index: true },
        // Last client fingerprint + detector seen for this IP (latest wins).
        fingerprint: { type: String },
        asn: { type: Number },
        country: { type: String },
        detector: { type: String }, // top signal / status of the latest hit
        count: { type: Number, default: 0 },
        firstSeen: { type: Date },
        lastSeen: { type: Date },
    },
    { timestamps: true }
);

threatIntelSchema.index({ ip: 1, fingerprint: 1 });

export const ThreatIntel = mongoose.model("ThreatIntel", threatIntelSchema);
