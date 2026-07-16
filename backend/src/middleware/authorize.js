import { asyncHandler } from "../utils/asyncHandler.js"
import { APIError } from "../utils/apierror.js"
import { Membership } from "../models/membership.model.js"
import { Project } from "../models/project.model.js"
import { Team } from "../models/team.model.js"
import { hasPermission } from "../rbac/hasPermission.js"

// Resolve WHERE the requested resource lives (its org/team/project), reading the
// authoritative parent from the DB rather than trusting the request. Doing the
// project/team lookup here means a cross-org id is caught at authorization time,
// and the result is cached on req.tenant so controllers (and tenantRepo, 3.3)
// don't fetch it again. Returns null org when nothing resolves → caller 403s.
async function resolveTarget(req) {
    const projectId = req.params?.projectId || req.body?.projectId
    if (projectId) {
        const project = await Project.findById(projectId).select("_id organizationId teamId")
        if (!project) throw new APIError(404, "Project not found")
        return { organizationId: project.organizationId, teamId: project.teamId, projectId: project._id, project }
    }
    const teamId = req.params?.teamId || req.body?.teamId
    if (teamId) {
        const team = await Team.findById(teamId).select("_id organizationId")
        if (!team) throw new APIError(404, "Team not found")
        return { organizationId: team.organizationId, teamId: team._id }
    }
    // Org-level target: an explicit orgId param, else the caller's home org.
    const organizationId = req.params?.orgId || req.body?.organizationId || req.user?.organizationId
    return { organizationId }
}

// authorize(resource, action, { resolveScope? }) — use AFTER verifyJWT.
// Fail-closed: no user, no resolvable org, or no covering grant ⇒ deny.
export const authorize = (resource, action, options = {}) =>
    asyncHandler(async (req, res, next) => {
        if (!req.user?._id) throw new APIError(401, "Unauthorized")

        const target = await (options.resolveScope || resolveTarget)(req)
        if (!target?.organizationId) throw new APIError(403, "Forbidden: no organization scope")

        // Cache for downstream controllers / tenantRepo (do the lookup once).
        req.tenant = target

        const memberships = await Membership.find({
            userId: req.user._id,
            organizationId: target.organizationId,
        }).select("organizationId scopeType teamId projectId role")

        if (!hasPermission(memberships, resource, action, target)) {
            throw new APIError(403, `Forbidden: missing ${resource}:${action}`)
        }
        next()
    })

// Load a user's grants in an org (exposed for controllers that need to reason
// about permissions beyond a single route gate).
export const loadMemberships = (userId, organizationId) =>
    Membership.find({ userId, organizationId }).select("organizationId scopeType teamId projectId role")
