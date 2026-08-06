import mongoose, {Schema} from "mongoose";

const apikeySchema = new Schema(
    {
        // Stores the sha256 HASH of the API key, never the plaintext. Lookups
        // hash the incoming key first. A DB dump no longer leaks usable keys.
        key :{
            type : String,
            required : true,
        },
        // Non-secret display fragment (e.g. "sk_live_ab12cd…") for the dashboard.
        keyPrefix : {
            type : String
        },
        userId : {
            type : Schema.Types.ObjectId,
            ref : "User",
            required : true,

        },
        organizationId : {
            type : Schema.Types.ObjectId,
            ref : "Organization",
            index : true
        },
        projectId : {
            type : Schema.Types.ObjectId,
            ref : "Project",
            required : true,
        },
        // Environment this key is scoped to (Phase 3.1). Nullable pre-backfill,
        // then always set (backfill assigns the project's default env; key
        // creation picks one going forward). env→project→org must resolve.
        environmentId : {
            type : Schema.Types.ObjectId,
            ref : "Environment",
            index : true
        },
        // permissions : {
        //     type : String,
        //     enum : [""]
        // }
        status : {
            type : String,
            enum : ["active","revoked"],
            default : "active"
        },
        credits : {
            type : Number,
            default : 100
        },
        lastUsedAt : {
            type : Date,
            required : [true, "Date is required!"]
        } // change it to time

    },
    {
        timestamps : true
    }
)

// Hot-path lookup: checkuserlimit / logUsage do ApiKey.findOne({ key }).
// Unique index turns a full-collection scan into an O(log n) point lookup.
// NOTE: Phase 1 replaces plaintext `key` with a hashed `keyHash`; index moves then.
apikeySchema.index({ key: 1 }, { unique: true })

export const ApiKey =  mongoose.model("ApiKey",apikeySchema)