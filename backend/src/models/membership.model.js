import mongoose, { Schema } from "mongoose";
import { ROLES, SCOPE_TYPES } from "../rbac/roles.js";

// Membership — a single role grant: "user U has role R at scope S". A user can
// hold several (e.g. Developer org-wide + Admin on one team); Phase 3.2 resolves
// effective permissions as the ADDITIVE UNION of every grant whose scope covers
// the resource. There is deliberately no single "effective role".
//
// Scope shape: `organizationId` is always set (the tenant). `scopeType` says how
// far the grant reaches; `teamId`/`projectId` narrow it:
//   - org     → whole org            (teamId & projectId null)
//   - team    → one team's projects  (teamId set,  projectId null)
//   - project → one project          (teamId set,  projectId set)
const membershipSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        organizationId: {
            type: Schema.Types.ObjectId,
            ref: "Organization",
            required: true,
            index: true
        },
        scopeType: {
            type: String,
            enum: SCOPE_TYPES,
            required: true
        },
        teamId: {
            type: Schema.Types.ObjectId,
            ref: "Team",
            default: null
        },
        projectId: {
            type: Schema.Types.ObjectId,
            ref: "Project",
            default: null
        },
        role: {
            type: String,
            enum: ROLES,
            required: true
        }
    },
    { timestamps: true }
);

// Keep scope fields consistent with scopeType so resolution never has to guess.
// Sync pre-validate hook (throws on bad input) — no next() callback.
membershipSchema.pre("validate", function () {
    if (this.scopeType === "org") {
        this.teamId = null
        this.projectId = null
    } else if (this.scopeType === "team") {
        this.projectId = null
        if (!this.teamId) throw new Error("team-scoped membership needs teamId")
    } else if (this.scopeType === "project") {
        if (!this.projectId) throw new Error("project-scoped membership needs projectId")
    }
})

// Fast "what can this user do in this org" lookup (the hot path for authorize()).
membershipSchema.index({ userId: 1, organizationId: 1 })
// One grant per (user, exact scope) — re-granting updates the role, not duplicates.
membershipSchema.index(
    { userId: 1, organizationId: 1, scopeType: 1, teamId: 1, projectId: 1 },
    { unique: true }
)

export const Membership = mongoose.model("Membership", membershipSchema);
