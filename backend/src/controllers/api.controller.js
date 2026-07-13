import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Project } from "../models/project.model.js";
import { ApiKey } from "../models/apikey.model.js";
import { generateApiKey } from "../utils/tokens.js";


// Auth handled by verifyJWT (req.user). The stored `key` is a sha256 HASH; the
// plaintext `sk_live_…` key is returned to the caller exactly once and never
// persisted or shown again.
const creatNewAPIKey = asyncHandler( async(req,res,next) =>{
    const {projectId} = req.body

    if(!projectId){
        throw new APIError(400,"projectId is required")
    }

    const foundproject = await Project.findById(projectId)
    if(!foundproject)
    {
        throw new APIError(404,"Project does not exist")
    }

    if(foundproject.userId.toString() !== req.user._id.toString())
    {
        throw new APIError(403,"You do not own this project")
    }

    const { full, hash, prefix } = generateApiKey()

    const apiKey = await ApiKey.create({
        key : hash,
        keyPrefix : prefix,
        userId : foundproject.userId,
        organizationId : foundproject.organizationId || req.user.organizationId,
        projectId : foundproject._id,
        lastUsedAt : new Date()
    })

    return res
        .status(201)
        .json(new APIResponse(201, {
            id: apiKey._id,
            key: full,            // shown ONCE — store it now
            keyPrefix: prefix,
            projectId: apiKey.projectId,
            credits: apiKey.credits,
            createdAt: apiKey.createdAt
        }, "New APIKey created. Copy it now — it will not be shown again."))
})

export {
    creatNewAPIKey
}


