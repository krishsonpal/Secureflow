import mongoose, {Schema} from "mongoose";

const projectSchema = new Schema({
    userId : {
        type : Schema.Types.ObjectId,
        ref : "User"
    },
    projectName : {
        type : String,
        required : [true , "Project name is required"],
        trim : true,
        index : true
    },
    description : {
        type : String,
        trim : true
    },
    status : {
        type : String,
        enum : ["active", "suspended"],
        default : "active"
    },
},
{
    timestamps : true
})

export const Project = mongoose.model("Project",projectSchema)