import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Project } from "../models/project.model.js";

import { APIUsage } from "../models/apiusage.model.js";
import { UsageRollup, THREAT_STATUSES } from "../models/usagerollup.model.js";

// Read the cumulative rollup for a project. If it doesn't exist yet (project
// predates Part 1.8, or has never been rolled up), backfill it once from the
// APIUsage collection so the numbers are correct and every later read is O(1).
// The worker is the steady-state writer; this is a one-time self-heal.
const getOrBackfillRollup = async (projectId) => {
    const existing = await UsageRollup.findOne({ projectId })
    if (existing) return existing

    const [totalRequests, threatsBlocked, rateLimited] = await Promise.all([
        APIUsage.countDocuments({ projectId }),
        APIUsage.countDocuments({ projectId, status: { $in: THREAT_STATUSES } }),
        APIUsage.countDocuments({ projectId, status: "rate-limited" }),
    ])

    // $setOnInsert so a concurrent worker $inc (upsert) doesn't get clobbered.
    await UsageRollup.updateOne(
        { projectId },
        { $setOnInsert: { projectId, totalRequests, threatsBlocked, rateLimited } },
        { upsert: true }
    )
    return { totalRequests, threatsBlocked, rateLimited }
}

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

    // Part 1.8: totals come from the O(1) rollup (no full-collection scan); the
    // rollup read, the live "active sessions" window, and the recent-logs query
    // are independent, so run them concurrently instead of sequentially.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const [rollup, activeSessionsResult, recentLogs] = await Promise.all([
        getOrBackfillRollup(projectId),
        APIUsage.aggregate([
            { $match: { projectId: project._id, createdAt: { $gte: oneHourAgo } } },
            { $group: { _id: "$fingerprint" } },
            { $count: "uniqueSessions" }
        ]),
        APIUsage.find({ projectId }).sort({ createdAt: -1 }).limit(50)
    ])

    const activeSessions = activeSessionsResult.length > 0 ? activeSessionsResult[0].uniqueSessions : 0

    return res.status(200).json(
        new APIResponse(200, {
            metrics: {
                totalRequests: rollup.totalRequests || 0,
                threatsBlocked: rollup.threatsBlocked || 0,
                rateLimited: rollup.rateLimited || 0,
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
