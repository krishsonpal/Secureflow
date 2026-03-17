import mongoose, {Schema} from "mongoose";

const clientUserSchema = new Schema({
    fingerPrint : {
        type : String,
        required : [true,"fingerprint is required"]
    },
    projectId : {
        type : Schema.Types.ObjectId,
        ref : "Project"
    }
})

export const ClientUserSchema = mongoose.model("ClientUserSchema",clientUserSchema)