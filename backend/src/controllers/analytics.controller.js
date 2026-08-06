import { APIResponse } from "../utils/apiresponse.js"
import { APIError } from "../utils/apierror.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { APIUsage } from "../models/apiusage.model.js"
import { THREAT_STATUSES } from "../models/usagerollup.model.js"
import { tenantRepo } from "../utils/tenantScope.js"
import { maskIp } from "../utils/maskIp.js"

// Phase 3.10 (Dashboard V2) — read-only analytics over the tenant-scoped
// APIUsage collection. authorize("analytics","read") has already resolved the
// project's tenant onto req.tenant; every query goes through tenantRepo so it is
// scoped to the caller's org by construction (no cross-tenant reads possible).

const ACTIONS = new Set(["allow", "challenge", "block"])
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// GET /projects/:projectId/events — filtered, cursor-paginated event search for
// the Threat Explorer. Cursor is createdAt (?before=<ISO>), newest-first.
const searchEvents = asyncHandler(async (req, res) => {
    const projectId = req.tenant.project._id
    const { status, action, riskMin, riskMax, from, to, fingerprint, ip, q, limit, before } = req.query

    const filter = { projectId }
    if (status) filter.status = status
    if (action && ACTIONS.has(action)) filter.action = action
    if (fingerprint) filter.fingerprint = fingerprint

    // riskScore range — either bound optional.
    const risk = {}
    if (riskMin !== undefined && riskMin !== "" && Number.isFinite(Number(riskMin))) risk.$gte = Number(riskMin)
    if (riskMax !== undefined && riskMax !== "" && Number.isFinite(Number(riskMax))) risk.$lte = Number(riskMax)
    if (Object.keys(risk).length) filter.riskScore = risk

    // createdAt window + the pagination cursor share the same field.
    const createdAt = {}
    if (from) { const d = new Date(from); if (!isNaN(d)) createdAt.$gte = d }
    if (to) { const d = new Date(to); if (!isNaN(d)) createdAt.$lte = d }
    if (before) { const d = new Date(before); if (!isNaN(d)) createdAt.$lt = d }
    if (Object.keys(createdAt).length) filter.createdAt = createdAt

    // Normalize the incoming IP through the SAME maskIp() the worker stored with,
    // so search matches the persisted representation across every mode. In `none`
    // mode maskIp → null, so an ip filter is intentionally a no-op.
    if (ip) {
        const masked = maskIp(ip)
        if (masked) filter.ip = masked
    }

    // Free-text over the message (escaped → literal substring, case-insensitive).
    if (q) filter.message = { $regex: escapeRegex(q), $options: "i" }

    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200)
    const events = await tenantRepo(req, APIUsage)
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(lim)

    // Only advertise a cursor when the page was full (another page may exist).
    const nextBefore = events.length === lim ? events[events.length - 1].createdAt : null

    return res.status(200).json(
        new APIResponse(200, { events, nextBefore }, "Events fetched successfully")
    )
})

// GET /projects/:projectId/geo — attack origins by country for the Attack Map.
// Counts THREAT-status events per country over the last ?hours (default 24).
const geoBreakdown = asyncHandler(async (req, res) => {
    const projectId = req.tenant.project._id
    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 168) // cap 7d
    const since = new Date(Date.now() - hours * 60 * 60 * 1000)

    const rows = await tenantRepo(req, APIUsage).aggregate([
        {
            $match: {
                projectId,
                createdAt: { $gte: since },
                status: { $in: THREAT_STATUSES },
                country: { $ne: null },
            },
        },
        { $group: { _id: "$country", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
    ])

    const breakdown = rows
        .filter((r) => r._id) // drop any null/empty country buckets
        .map((r) => ({ country: r._id, count: r.count }))

    return res.status(200).json(
        new APIResponse(200, { hours, breakdown }, "Geo breakdown fetched successfully")
    )
})

export { searchEvents, geoBreakdown }
