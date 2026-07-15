import mongoose, { Schema } from "mongoose";

// Detection rule (Phase 2.2). Declarative, hot-reloadable policy evaluated by the
// decision middleware AFTER the weighted-sum score. A rule's condition tree runs
// over the evaluation context (fused riskScore + per-signal confidences + request
// features); a matching enforcing rule (allow/challenge/block) overrides the
// scored action, and "log" records a match without changing enforcement.
//
// `conditions` is a free-form JSON tree: { all: [...] } / { any: [...] } groups
// nesting down to leaf conditions { fact, operator, value }. Its shape is
// validated at write time (ruleEngine.validateConditions) and evaluated safely
// (no eval; whitelisted operators) at request time.
const detectionRuleSchema = new Schema(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: "Project",
            required: true,
            index: true,
        },
        organizationId: {
            type: Schema.Types.ObjectId,
            ref: "Organization",
            index: true,
        },
        name: { type: String, required: true, trim: true },
        description: { type: String, default: "" },
        // Higher priority wins when multiple enforcing rules match.
        priority: { type: Number, default: 0 },
        enabled: { type: Boolean, default: true },
        conditions: { type: Schema.Types.Mixed, required: true },
        action: {
            type: String,
            enum: ["allow", "log", "challenge", "block"],
            default: "block",
        },
    },
    { timestamps: true }
);

export const DetectionRule = mongoose.model("DetectionRule", detectionRuleSchema);
