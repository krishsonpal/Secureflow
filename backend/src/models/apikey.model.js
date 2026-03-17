import mongoose, {Schema} from "mongoose";

const apikeySchema = new Schema(
    {
        key :{
            type : String,
            required : true,
        },
        userId : {
            type : Schema.Types.ObjectId,
            ref : "User",
            required : true,

        },
        projectId : {
            type : Schema.Types.ObjectId,
            ref : "Project",
            required : true,
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

export const ApiKey =  mongoose.model("ApiKey",apikeySchema)