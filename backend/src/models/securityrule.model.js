import mongoose, {Schema} from "mongoose";

const securityRuleSchema = new Schema(
    {
        key :{
            type : String,
            required : true,
        },
        rateLimit : {
            type : Number,
            default : 100
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