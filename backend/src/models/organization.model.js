import mongoose, { Schema } from "mongoose";

// Minimal tenant root. Full Org→Team→Env→Key model + RBAC matrix is Phase 2
// (doc 04); Phase 1 just "lays in" the tenant so every record carries an
// organizationId from day one and the later migration is trivial.
const organizationSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
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
