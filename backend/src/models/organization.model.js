import mongoose, { Schema } from "mongoose";

// Tenant root (the billing/isolation boundary). Phase 1 laid this in as a
// minimal stub so every record could carry an organizationId from day one.
// Phase 3.1 grows it into the real Org→Team→Project→Environment→Key tree:
// `slug` (stable URL/handle) + `plan` (billing placeholder) are added here;
// Team/Environment/Membership are their own collections.
const organizationSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        // Stable, URL-safe handle. Unique when present; `sparse` so pre-backfill
        // rows without a slug don't collide on null.
        slug: {
            type: String,
            trim: true,
            lowercase: true,
            unique: true,
            sparse: true
        },
        // Billing tier placeholder — metering/invoicing is Enterprise (doc 04
        // §Cap6, deferred). Kept here so the field exists before billing lands.
        plan: {
            type: String,
            enum: ["free", "pro", "enterprise"],
            default: "free"
        },
        ownerUserId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        }
    },
    { timestamps: true }
);

export const Organization = mongoose.model("Organization", organizationSchema);
