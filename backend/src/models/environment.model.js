import mongoose, { Schema } from "mongoose";

// Environment — a deployment target of a project (dev / staging / prod, or a
// custom name). Belongs to exactly one project (`projectId` required); API keys
// are scoped to an environment, so the chain env→project→org must always
// resolve. `organizationId` is denormalized on for direct tenant filtering
// (tenantRepo, Phase 3.3) without a project join.
const environmentSchema = new Schema(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: "Project",
            required: true,
            index: true
        },
        organizationId: {
            type: Schema.Types.ObjectId,
            ref: "Organization",
            required: true,
            index: true
        },
        name: {
            type: String,
            required: true,
            trim: true // "dev" | "staging" | "prod" | custom
        },
        // Marks the auto-created default environment for a project.
        isDefault: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

// No two environments with the same name inside one project.
environmentSchema.index({ projectId: 1, name: 1 }, { unique: true });

export const Environment = mongoose.model("Environment", environmentSchema);
