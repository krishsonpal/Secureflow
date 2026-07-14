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
        rateLimit : {
            type : Number,
            default : 100
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
    
 },
    {
        timestamps : true
    }
)

export const SecurityRule =  mongoose.model("SecurityRule",securityRuleSchema)