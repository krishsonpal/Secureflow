import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Project } from "../models/project.model.js";
import { Team } from "../models/team.model.js";
import { Environment } from "../models/environment.model.js";
import { ApiKey } from "../models/apikey.model.js";

import { APIUsage } from "../models/apiusage.model.js";
import { UsageRollup, THREAT_STATUSES } from "../models/usagerollup.model.js";
import { SecurityRule } from "../models/securityrule.model.js";
import { loadSecurityRule, invalidateSecurityRule } from "../utils/securityRule.js";
import { DetectionRule } from "../models/detectionrule.model.js";
import { invalidateRules } from "../utils/detectionRules.js";
import { validateConditions } from "../detection/ruleEngine.js";
import { tenantRepo, tenantOrgId } from "../utils/tenantScope.js";

// Phase 3.3 — access is now org+membership based, enforced by authorize() on the
// route (which resolves the project's tenant, verifies the caller has a covering
// grant, and caches the resolved scope on req.tenant). Controllers no longer do
// userId-ownership checks; they read req.tenant and query through tenantRepo so
// every read/write is scoped to the tenant by construction.

// Read the cumulative rollup for a project. If it doesn't exist yet, backfill it
// once from APIUsage so the numbers are correct and later reads are O(1). All
// queries are tenant-scoped.
const getOrBackfillRollup = async (req, projectId) => {
    const existing = await tenantRepo(req, UsageRollup).findOne({ projectId })
    if (existing) return existing

    const [totalRequests, threatsBlocked, rateLimited] = await Promise.all([
        tenantRepo(req, APIUsage).countDocuments({ projectId }),
        tenantRepo(req, APIUsage).countDocuments({ projectId, status: { $in: THREAT_STATUSES } }),
        tenantRepo(req, APIUsage).countDocuments({ projectId, status: "rate-limited" }),
    ])

    // $setOnInsert so a concurrent worker $inc (upsert) doesn't get clobbered.
    // organizationId is injected into the filter by tenantRepo → seeded on insert.
    await tenantRepo(req, UsageRollup).updateOne(
        { projectId },
        { $setOnInsert: { projectId, totalRequests, threatsBlocked, rateLimited } },
        { upsert: true }
    )
    return { totalRequests, threatsBlocked, rateLimited }
}

const createNewProject = asyncHandler(async (req, res) => {
    const { projectName, description } = req.body || {}
    if (!projectName) throw new APIError(400, "Project name is required")

    const organizationId = tenantOrgId(req)

    const existedProject = await tenantRepo(req, Project).findOne({ projectName })
    if (existedProject) throw new APIError(409, "Project already exists")

    // Strict tree: every project belongs to a team. Land it in the org's default
    // team (self-heal if somehow absent — an org should always have one).
    const team = await Team.findOne({ organizationId, isDefault: true })
        || await Team.create({ organizationId, name: "Default", isDefault: true })

    const project = await Project.create({
        userId: req.user._id,
        organizationId,
        teamId: team._id,
        projectName,
        description: description || ""
    })

    // Default environment so API keys can be scoped immediately.
    await Environment.create({ projectId: project._id, organizationId, name: "production", isDefault: true })

    const createdProject = await Project.findById(project._id).select("-userId")
    if (!createdProject) throw new APIError(500, "Something went wrong while creating Project")

    return res
        .status(201)
        .json(new APIResponse(201, createdProject, "New Project Created Successfully"))
})

const deleteProject = asyncHandler(async (req, res) => {
    const { projectId } = req.body
    if (!projectId) throw new APIError(400, "Project id is required")

    // authorize() already verified project:delete on this project within the
    // caller's org. The tenant-scoped delete is the enforcement backstop.
    const result = await tenantRepo(req, Project).deleteOne({ _id: projectId })
    if (!result.deletedCount) throw new APIError(404, "Project not found or unauthorized")

    // Scoped cascade — don't orphan the project's environments / keys.
    await Promise.all([
        tenantRepo(req, Environment).deleteMany({ projectId }),
        tenantRepo(req, ApiKey).deleteMany({ projectId }),
    ])

    return res
        .status(200)
        .json(new APIResponse(200, {}, "Project Deleted Successfully"))
})

const getMyProjects = asyncHandler(async (req, res) => {
    // Every project in the caller's org (they hold project:read at org scope).
    const projects = await tenantRepo(req, Project).find({})
    return res
        .status(200)
        .json(new APIResponse(200, projects, "Projects fetched successfully"))
})

const getProjectAnalytics = asyncHandler(async (req, res) => {
    const project = req.tenant.project // resolved + authorized by authorize()
    const projectId = project._id

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const [rollup, activeSessionsResult, recentLogs] = await Promise.all([
        getOrBackfillRollup(req, projectId),
        tenantRepo(req, APIUsage).aggregate([
            { $match: { projectId, createdAt: { $gte: oneHourAgo } } },
            { $group: { _id: "$fingerprint" } },
            { $count: "uniqueSessions" }
        ]),
        tenantRepo(req, APIUsage).find({ projectId }).sort({ createdAt: -1 }).limit(50)
    ])

    const activeSessions = activeSessionsResult.length > 0 ? activeSessionsResult[0].uniqueSessions : 0

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
// actual history. ?hours=24 (default), ?buckets=24 → one point per hour.
const getProjectTimeseries = asyncHandler(async (req, res) => {
    const project = req.tenant.project
    const projectId = project._id

    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 168) // cap 7d
    const buckets = Math.min(Math.max(Number(req.query.buckets) || hours, 1), 168)
    const windowMs = hours * 60 * 60 * 1000
    const bucketMs = Math.floor(windowMs / buckets)

    const endBucket = Math.floor(Date.now() / bucketMs) * bucketMs
    const startBucket = endBucket - (buckets - 1) * bucketMs
    const since = new Date(startBucket)

    const rows = await tenantRepo(req, APIUsage).aggregate([
        { $match: { projectId, createdAt: { $gte: since } } },
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
// projectId is server-trusted here — authorize() validated it belongs to the
// caller's org before this runs — so the cached loader-by-projectId is safe.
const getSecurityRule = asyncHandler(async (req, res) => {
    const rule = await loadSecurityRule(req.params.projectId)
    return res.status(200).json(new APIResponse(200, rule, "Security rule fetched"))
})

// Create/update the project's SecurityRule and invalidate the cached copy so the
// rate limiter picks up the change immediately.
const updateSecurityRule = asyncHandler(async (req, res) => {
    const { projectId } = req.params

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

    const rule = await tenantRepo(req, SecurityRule).findOneAndUpdate(
        { projectId },
        { $set: { projectId, ...update } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    )
    await invalidateSecurityRule(projectId)

    return res.status(200).json(new APIResponse(200, rule, "Security rule updated"))
})

// --- Detection rules (Phase 2.2) -------------------------------------------

const getDetectionRules = asyncHandler(async (req, res) => {
    const rules = await tenantRepo(req, DetectionRule).find({ projectId: req.params.projectId }).sort({ priority: -1 })
    return res.status(200).json(new APIResponse(200, rules, "Detection rules fetched"))
})

// Replace the project's entire detection-rule set (the visual builder PUTs the
// full array). Each rule is validated + normalized; publishes an invalidation so
// every process hot-reloads without a restart.
const updateDetectionRules = asyncHandler(async (req, res) => {
    const { projectId } = req.params
    const organizationId = tenantOrgId(req)

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
            organizationId,
            name: r.name.trim(),
            description: typeof r.description === "string" ? r.description : "",
            priority: Number.isFinite(Number(r.priority)) ? Number(r.priority) : 0,
            enabled: r.enabled !== false,
            conditions: r.conditions,
            action,
        }
    })

    // Replace-all semantics keep the store in sync with the editor's view.
    await tenantRepo(req, DetectionRule).deleteMany({ projectId })
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
