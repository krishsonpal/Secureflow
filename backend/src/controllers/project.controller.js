import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Project } from "../models/project.model.js";

import jwt from "jsonwebtoken"
import { User } from "../models/user.model.js";
import { APIUsage } from "../models/apiusage.model.js";

const createNewProject = asyncHandler( async(req,res,next)=>{
    const accessToken = req.cookies.accessToken || req.headers.authorization?.split(" ")[1];
    const { projectName, description } = req.body || {}
    
    if(!accessToken){
            throw new APIError(400,"AccessToken is missing")
        }
    
        try{
            const decodedToken = jwt.verify(
                accessToken,
                process.env.ACCESS_TOKEN_SECRET
            )
            const user = await User.findById(decodedToken?._id)
            if(!user)
            {
                throw new APIError(401,"Invalid access token")
            }

            if(!projectName)
            {
                throw new APIError(401,"Project name is required")
            }

            const existedProject = await Project.findOne({
                    $and : [{ userId: decodedToken._id }, 
                            { projectName: projectName }]
                })

            if(existedProject)
            {
                throw new APIError(401,"Project already exists")
            }

            const project  = await  Project.create({
                    userId: decodedToken._id ,
                    projectName: projectName,
                    description : description || ""
                })


            const createdProject = await Project.findById(project._id).select(
                    "-userId"
                )
            if(!createdProject){
                    throw new APIError(500, "Something went wrong will creating Project")
            }
            return res
            .status(201)
            .json(
                new APIResponse(201,createdProject,"New Project Created Successfully")
            )

        }
        catch(error){
        throw new APIError(401,error?.message || "Invalid refresh token")
        }
    }
)

const deleteProject = asyncHandler( async(req,res,next)=>{
    const accessToken = req.cookies.accessToken || req.headers.authorization?.split(" ")[1];
    const {projectId} = req.body
    
    if(!accessToken){
            throw new APIError(400,"AccessToken is missing")
        }
    
        try{
            const decodedToken = jwt.verify(
                accessToken,
                process.env.ACCESS_TOKEN_SECRET
            )
            const user = await User.findById(decodedToken?._id)
            if(!user)
            {
                throw new APIError(401,"Invalid access token")
            }

            if(!projectId)
            {
                throw new APIError(401,"Project id is required")
            }

            const project = await Project.findByIdAndDelete(projectId)
            if(!project){
                    throw new APIError(500, "Something went wrong while deleting project")
            }
            return res
            .status(200)
            .json(
                new APIResponse(200,{},"Project Deleted Successfully")
            )

        }
        catch(error){
            throw new APIError(501,"An error occured while deleting project")
        }

} )

const getMyProjects = asyncHandler(async (req, res) => {
    const accessToken = req.cookies.accessToken || req.headers.authorization?.split(" ")[1];

    if (!accessToken) {
        throw new APIError(400, "AccessToken is missing");
    }

    try {
        const decodedToken = jwt.verify(
            accessToken,
            process.env.ACCESS_TOKEN_SECRET
        );
        const projects = await Project.find({ userId: decodedToken._id });
        
        return res.status(200).json(
            new APIResponse(200, projects, "Projects fetched successfully")
        );
    } catch (error) {
        throw new APIError(401, error?.message || "Invalid token");
    }
});

const getProjectAnalytics = asyncHandler(async (req, res) => {
    const accessToken = req.cookies.accessToken || req.headers.authorization?.split(" ")[1];
    const { projectId } = req.params;

    if (!accessToken) {
        throw new APIError(400, "AccessToken is missing");
    }

    if (!projectId) {
        throw new APIError(400, "ProjectId is missing");
    }

    try {
        const decodedToken = jwt.verify(
            accessToken,
            process.env.ACCESS_TOKEN_SECRET
        );
        
        // Verify project belongs to user
        const project = await Project.findOne({ _id: projectId, userId: decodedToken._id });
        if (!project) {
            throw new APIError(404, "Project not found or unauthorized");
        }

        // Aggregate Metrics
        const totalRequests = await APIUsage.countDocuments({ projectId });
        const threatsBlocked = await APIUsage.countDocuments({ 
            projectId, 
            status: { $in: ['failed', 'locked', 'xss', 'session-theft', 'bot'] } 
        });
        const rateLimited = await APIUsage.countDocuments({ 
            projectId, 
            status: 'rate-limited' 
        });

        // Get count of unique active sessions (fingerprints) in the last hour
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const activeSessionsResult = await APIUsage.aggregate([
            { $match: { projectId: project._id, createdAt: { $gte: oneHourAgo } } },
            { $group: { _id: "$fingerprint" } },
            { $count: "uniqueSessions" }
        ]);
        const activeSessions = activeSessionsResult.length > 0 ? activeSessionsResult[0].uniqueSessions : 0;

        // Fetch recent logs (last 50)
        const recentLogs = await APIUsage.find({ projectId })
            .sort({ createdAt: -1 })
            .limit(50);

        // Fetch hourly requests over the last 20 hours (approximate for chart context)
        // Note: For simple display, we'll let frontend handle chart aggregation if needed, or pass simple counts.
        
        return res.status(200).json(
            new APIResponse(200, {
                metrics: {
                    totalRequests,
                    threatsBlocked,
                    rateLimited,
                    activeSessions: activeSessions === 0 ? 1 : activeSessions // default to 1 for visual
                },
                logs: recentLogs
            }, "Project analytics fetched successfully")
        );
    } catch (error) {
        throw new APIError(401, error?.message || "Invalid token");
    }
});

export {
    createNewProject,
    deleteProject,
    getMyProjects,
    getProjectAnalytics
}