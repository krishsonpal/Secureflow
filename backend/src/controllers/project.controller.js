import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Project } from "../models/project.model.js";

import { APIUsage } from "../models/apiusage.model.js";
import { UsageRollup, THREAT_STATUSES } from "../models/usagerollup.model.js";
import { SecurityRule } from "../models/securityrule.model.js";
import { loadSecurityRule, invalidateSecurityRule } from "../utils/securityRule.js";
import { DetectionRule } from "../models/detectionrule.model.js";
import { invalidateRules } from "../utils/detectionRules.js";
import { validateConditions } from "../detection/ruleEngine.js";

// Assert the project belongs to the authenticated user; returns the project or
// throws 404. Shared by the analytics/timeseries/security-rule endpoints.
const assertOwnedProject = async (projectId, userId) => {
    if (!projectId) throw new APIError(400, "ProjectId is missing")
    const project = await Project.findOne({ _id: projectId, userId })
    if (!project) throw new APIError(404, "Project not found or unauthorized")
    return project
}

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

    // byStatus is a Mongo Map on a hydrated rollup; normalize to a plain object
    // (absent on the lazy-backfill path).
    const byStatus = rollup.byStatus instanceof Map
        ? Object.fromEntries(rollup.byStatus)
        : (rollup.byStatus || {})

    return res.status(200).json(
        new APIResponse(200, {
            metrics: {
                totalRequests: rollup.totalRequests || 0,
                threatsBlocked: rollup.threatsBlocked || 0,
                rateLimited: rollup.rateLimited || 0,
                activeSessions: activeSessions === 0 ? 1 : activeSessions, // default to 1 for visual
                byStatus
            },
            logs: recentLogs
        }, "Project analytics fetched successfully")
    )
})

// Real trend data: bucket APIUsage over a window so the dashboard chart shows
// actual history instead of only live-accumulated points. ?hours=24 (default),
// ?buckets=24 → one point per hour. Threats counted alongside total requests.
const getProjectTimeseries = asyncHandler(async (req, res) => {
    const { projectId } = req.params
    const project = await assertOwnedProject(projectId, req.user._id)

    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 168) // cap 7d
    const buckets = Math.min(Math.max(Number(req.query.buckets) || hours, 1), 168)
    const windowMs = hours * 60 * 60 * 1000
    const bucketMs = Math.floor(windowMs / buckets) // integer ms so bucket keys align

    // Anchor the LAST bucket on the current bucket so freshly-created events (which
    // land in "now"'s bucket) are included; walk back `buckets-1` steps for the start.
    const endBucket = Math.floor(Date.now() / bucketMs) * bucketMs
    const startBucket = endBucket - (buckets - 1) * bucketMs
    const since = new Date(startBucket)

    const rows = await APIUsage.aggregate([
        { $match: { projectId: project._id, createdAt: { $gte: since } } },
        {
            $group: {
                _id: {
                    $toLong: {
                        $subtract: [
                            { $toLong: "$createdAt" },
                            { $mod: [{ $toLong: "$createdAt" }, bucketMs] }
                        ]
                    }
                },
                requests: { $sum: 1 },
                threats: { $sum: { $cond: [{ $in: ["$status", THREAT_STATUSES] }, 1, 0] } }
            }
        },
        { $sort: { _id: 1 } }
    ])

    // Fill empty buckets so the chart has a continuous X axis.
    const byBucket = new Map(rows.map((r) => [Number(r._id), r]))
    const series = []
    for (let i = 0; i < buckets; i++) {
        const ts = startBucket + i * bucketMs
        const hit = byBucket.get(ts)
        series.push({
            timestamp: new Date(ts).toISOString(),
            requests: hit?.requests || 0,
            threats: hit?.threats || 0
        })
    }

    return res.status(200).json(
        new APIResponse(200, { hours, buckets, series }, "Timeseries fetched successfully")
    )
})

// Read the project's SecurityRule (falls back to defaults if none set yet).
const getSecurityRule = asyncHandler(async (req, res) => {
    await assertOwnedProject(req.params.projectId, req.user._id)
    const rule = await loadSecurityRule(req.params.projectId)
    return res.status(200).json(new APIResponse(200, rule, "Security rule fetched"))
})

// Create/update the project's SecurityRule and invalidate the cached copy so the
// rate limiter picks up the change immediately. (Closes the Part 1.6 deferred
// admin-route item.)
const updateSecurityRule = asyncHandler(async (req, res) => {
    const { projectId } = req.params
    await assertOwnedProject(projectId, req.user._id)

    const allowed = ["rateLimit", "rateWindow", "otpLimit", "blockBots", "banDuration", "whitelistips"]
    const update = {}
    for (const k of allowed) {
        if (req.body[k] === undefined) continue
        if (k === "whitelistips") {
            update[k] = Array.isArray(req.body[k]) ? req.body[k].map(String) : []
        } else if (k === "blockBots") {
            update[k] = Boolean(req.body[k])
        } else {
            const n = Number(req.body[k])
            if (Number.isFinite(n) && n >= 0) update[k] = n
        }
    }

    const rule = await SecurityRule.findOneAndUpdate(
        { projectId },
        { $set: { projectId, ...update } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    )
    await invalidateSecurityRule(projectId)

    return res.status(200).json(new APIResponse(200, rule, "Security rule updated"))
})

// --- Detection rules (Phase 2.2) -------------------------------------------

// List the project's detection rules (priority desc).
const getDetectionRules = asyncHandler(async (req, res) => {
    await assertOwnedProject(req.params.projectId, req.user._id)
    const rules = await DetectionRule.find({ projectId: req.params.projectId }).sort({ priority: -1 })
    return res.status(200).json(new APIResponse(200, rules, "Detection rules fetched"))
})

// Replace the project's entire detection-rule set (the visual builder / editor
// PUTs the full array). Each rule is validated + normalized; the condition tree
// is structurally checked so malformed rules never reach the hot path. Publishes
// an invalidation so every process hot-reloads without a restart.
const updateDetectionRules = asyncHandler(async (req, res) => {
    const { projectId } = req.params
    const project = await assertOwnedProject(projectId, req.user._id)

    const input = Array.isArray(req.body?.rules) ? req.body.rules : null
    if (!input) throw new APIError(400, "Body must be { rules: [...] }")

    const docs = input.map((r) => {
        if (!r || typeof r.name !== "string" || !r.name.trim()) {
            throw new APIError(400, "Each rule needs a non-empty name")
        }
        const condErr = validateConditions(r.conditions)
        if (condErr) throw new APIError(400, `Rule "${r.name}": ${condErr}`)
        const action = ["allow", "log", "challenge", "block"].includes(r.action) ? r.action : "block"
        return {
            projectId,
            organizationId: project.organizationId,
            name: r.name.trim(),
            description: typeof r.description === "string" ? r.description : "",
            priority: Number.isFinite(Number(r.priority)) ? Number(r.priority) : 0,
            enabled: r.enabled !== false,
            conditions: r.conditions,
            action,
        }
    })

    // Replace-all semantics keep the store in sync with the editor's view.
    await DetectionRule.deleteMany({ projectId })
    const created = docs.length ? await DetectionRule.insertMany(docs) : []
    await invalidateRules(projectId)

    return res.status(200).json(new APIResponse(200, created, "Detection rules updated"))
})

export {
    createNewProject,
    deleteProject,
    getMyProjects,
    getProjectAnalytics,
    getProjectTimeseries,
    getSecurityRule,
    updateSecurityRule,
    getDetectionRules,
    updateDetectionRules
}
