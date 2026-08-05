import mongoose, {Schema} from "mongoose";

const securityRuleSchema = new Schema(
    {
        // Legacy free-form identifier kept for backward compat. New config is
        // resolved by projectId (the server-trusted dimension), not this field.
        key :{
            type : String,
        },
        // The project this rule governs. One rule per project; the rate limiter
        // loads it by projectId (cached in Redis, like credits).
        projectId : {
            type : Schema.Types.ObjectId,
            ref : "Project",
            index : true,
            unique : true,
            sparse : true
        },
        // Tenant key (Phase 3.3) — so this row is filterable by tenantRepo like
        // every other collection (doc 04 §Cap1). The hot-path load is still by
        // projectId; this is for org-scoped management reads / defense-in-depth.
        organizationId : {
            type : Schema.Types.ObjectId,
            ref : "Organization",
            index : true
        },
        rateLimit : {
            type : Number,
            default : 100
        },
        userRateLimit : {
            type : Number,
            default : 60
        },
        // Window (seconds) the rateLimit applies over. Together they express
        // "rateLimit requests per rateWindow seconds".
        rateWindow : {
            type : Number,
            default : 60
        },
        otpLimit : {
            type : Number,
            default : 5
        },
        blockBots : {
            type : Boolean,
            default : true
        },
        banDuration : {
            type : Number ,
            default : 2000 // seconds
        },
        whitelistips : {
            type : [String],
            default : []
        },
        // Phase 2.1 — per-tenant detection scoring policy. Consumed by the
        // decision middleware via the weighted-sum scorer. All optional: absent
        // fields fall back to the scorer's DEFAULT_WEIGHTS / DEFAULT_THRESHOLDS,
        // so existing rows keep today's behavior (a full-confidence XSS = risk
        // 100 ≥ 70 → block).
        scoring : {
            // Per-signal contribution at confidence 1.0 (0..100). Overrides the
            // scorer defaults per detector name, e.g. { "prompt-injection": 90 }.
            weights : {
                type : Map,
                of : Number,
                default : undefined
            },
            blockThreshold : {
                type : Number,
                default : undefined
            },
            challengeThreshold : {
                type : Number,
                default : undefined
            },
        },

 },
    {
        timestamps : true
    }
)

export const SecurityRule =  mongoose.model("SecurityRule",securityRuleSchema)