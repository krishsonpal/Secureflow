import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Project } from "../models/project.model.js";

import { APIUsage } from "../models/apiusage.model.js";

// NOTE: auth is now handled by the shared `verifyJWT` middleware, which
// populates `req.user`. Controllers no longer re-implement jwt.verify or wrap
// everything in a try/catch that mislabels real 500s as 401/501.

const createNewProject = asyncHandler(async (req, res) => {
    const { projectName, description } = req.body || {}

    if (!projectName) {
        throw new APIError(400, "Project name is required")
    }

    const existedProject = await Project.findOne({
        userId: req.user._id,
        projectName
    })
    if (existedProject) {
        throw new APIError(409, "Project already exists")
    }

    const project = await Project.create({
        userId: req.user._id,
        organizationId: req.user.organizationId,
        projectName,
        description: description || ""
    })

    const createdProject = await Project.findById(project._id).select("-userId")
    if (!createdProject) {
        throw new APIError(500, "Something went wrong while creating Project")
    }

    return res
        .status(201)
        .json(new APIResponse(201, createdProject, "New Project Created Successfully"))
})

const deleteProject = asyncHandler(async (req, res) => {
    const { projectId } = req.body

    if (!projectId) {
        throw new APIError(400, "Project id is required")
    }

    // Ownership check — previously this deleted by id with no owner check.
    const project = await Project.findOne({ _id: projectId, userId: req.user._id })
    if (!project) {
        throw new APIError(404, "Project not found or unauthorized")
    }

    await Project.findByIdAndDelete(projectId)

    return res
        .status(200)
        .json(new APIResponse(200, {}, "Project Deleted Successfully"))
})

const getMyProjects = asyncHandler(async (req, res) => {
    const projects = await Project.find({ userId: req.user._id })
    return res
        .status(200)
        .json(new APIResponse(200, projects, "Projects fetched successfully"))
})

const getProjectAnalytics = asyncHandler(async (req, res) => {
    const { projectId } = req.params

    if (!projectId) {
        throw new APIError(400, "ProjectId is missing")
    }

    // Verify project belongs to the authenticated user
    const project = await Project.findOne({ _id: projectId, userId: req.user._id })
    if (!project) {
        throw new APIError(404, "Project not found or unauthorized")
    }

    // (Part 1.8 will parallelize these and read from rollups instead of scans.)
    const totalRequests = await APIUsage.countDocuments({ projectId })
    const threatsBlocked = await APIUsage.countDocuments({
        projectId,
        status: { $in: ['failed', 'locked', 'xss', 'session-theft', 'bot'] }
    })
    const rateLimited = await APIUsage.countDocuments({
        projectId,
        status: 'rate-limited'
    })

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const activeSessionsResult = await APIUsage.aggregate([
        { $match: { projectId: project._id, createdAt: { $gte: oneHourAgo } } },
        { $group: { _id: "$fingerprint" } },
        { $count: "uniqueSessions" }
    ])
    const activeSessions = activeSessionsResult.length > 0 ? activeSessionsResult[0].uniqueSessions : 0

    const recentLogs = await APIUsage.find({ projectId })
        .sort({ createdAt: -1 })
        .limit(50)

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
    )
})

export {
    createNewProject,
    deleteProject,
    getMyProjects,
    getProjectAnalytics
}
