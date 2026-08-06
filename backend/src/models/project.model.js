import mongoose, {Schema} from "mongoose";

const projectSchema = new Schema({
    userId : {
        type : Schema.Types.ObjectId,
        ref : "User"
    },
    organizationId : {
        type : Schema.Types.ObjectId,
        ref : "Organization",
        index : true
    },
    // Owning team (Phase 3.1). A project belongs to exactly one team; nullable
    // pre-backfill, then always set (the backfill assigns the org's default
    // team, and project-create sets it going forward). Strict tree — no
    // multi-team sharing in this slice.
    teamId : {
        type : Schema.Types.ObjectId,
        ref : "Team",
        index : true
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