import mongoose, { Schema } from "mongoose";
import { ROLES, SCOPE_TYPES } from "../rbac/roles.js";

// Pending member invite (Phase 3.4). The email link carries a random token; only
// its sha256 hash is stored (never the token). Single-use (status flips to
// accepted) and short-lived (expiresAt TTL). Accepting creates a Membership.
const invitationSchema = new Schema(
    {
        organizationId: {
            type: Schema.Types.ObjectId,
            ref: "Organization",
            required: true,
            index: true
        },
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true
        },
        // Grant to create on acceptance.
        role: { type: String, enum: ROLES, required: true },
        scopeType: { type: String, enum: SCOPE_TYPES, default: "org" },
        teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null },
        projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null },

        tokenHash: { type: String, required: true, unique: true },
        invitedBy: { type: Schema.Types.ObjectId, ref: "User" },
        status: { type: String, enum: ["pending", "accepted", "revoked"], default: "pending", index: true },
        expiresAt: { type: Date, required: true }
    },
    { timestamps: true }
);

// One outstanding invite per (org, email).
invitationSchema.index({ organizationId: 1, email: 1, status: 1 });
// TTL cleanup of expired invites (Mongo purges ~60s after expiry).
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Invitation = mongoose.model("Invitation", invitationSchema);
