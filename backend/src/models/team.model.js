import mongoose, { Schema } from "mongoose";

// Team — the RBAC grouping inside an org (doc 04 §Cap1). A team belongs to
// exactly one org; a project belongs to exactly one team (strict tree, decided
// Phase 3.1). Every org has exactly one `isDefault` team so simple orgs never
// have to think about teams — projects just land in the default.
const teamSchema = new Schema(
    {
        organizationId: {
            type: Schema.Types.ObjectId,
            ref: "Organization",
            required: true
            // No field-level index — the compound {organizationId, name} and the
            // partial default-team index below cover org-scoped lookups.
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        // Marks the org's catch-all team. Created by the backfill / org-create
        // flow; enforced unique-per-org by the partial index below.
        isDefault: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

// No two teams with the same name inside one org.
teamSchema.index({ organizationId: 1, name: 1 }, { unique: true });
// At most one default team per org (partial index only covers isDefault:true).
teamSchema.index(
    { organizationId: 1 },
    { unique: true, partialFilterExpression: { isDefault: true } }
);

export const Team = mongoose.model("Team", teamSchema);
