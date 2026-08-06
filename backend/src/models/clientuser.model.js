import mongoose, {Schema} from "mongoose";

const clientUserSchema = new Schema({
    fingerPrint : {
        type : String,
        required : [true,"fingerprint is required"]
    },
    projectId : {
        type : Schema.Types.ObjectId,
        ref : "Project"
    },
    organizationId : {
        type : Schema.Types.ObjectId,
        ref : "Organization",
        index : true
    }
})

// "Is this device already known for this project?" is a findOne on
// (fingerPrint, projectId) during registerLoginSuccess — index it.
clientUserSchema.index({ fingerPrint: 1, projectId: 1 })

export const ClientUserSchema = mongoose.model("ClientUserSchema",clientUserSchema)