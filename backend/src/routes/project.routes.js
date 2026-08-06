import { Router } from "express"

import {
    createNewProject,
    deleteProject,
    getMyProjects,
    getProjectAnalytics,
    getProjectTimeseries,
    getSecurityRule,
    updateSecurityRule,
    getDetectionRules,
    updateDetectionRules
} from "../controllers/project.controller.js"
import {
    createEnvironment,
    listEnvironments,
    deleteEnvironment
} from "../controllers/environment.controller.js"
import { searchEvents, geoBreakdown } from "../controllers/analytics.controller.js"
import { verifyJWT } from "../middleware/auth.middleware.js"
import { authorize } from "../middleware/authorize.js"

const router = Router()

// All project routes require an authenticated dashboard user. authorize() then
// resolves the target's tenant scope + checks the caller's membership grants
// (Phase 3.3); controllers read req.tenant and query through tenantRepo.
router.use(verifyJWT)

router.route("/create-project").post(authorize("project", "create"), createNewProject)
router.route("/delete-project").delete(authorize("project", "delete"), deleteProject)
router.route("/my-projects").get(authorize("project", "read"), getMyProjects)
router.route("/:projectId/analytics").get(authorize("analytics", "read"), getProjectAnalytics)
router.route("/:projectId/timeseries").get(authorize("analytics", "read"), getProjectTimeseries)
// Phase 3.10 (Dashboard V2) — Threat Explorer search + Attack Map geo breakdown.
router.route("/:projectId/events").get(authorize("analytics", "read"), searchEvents)
router.route("/:projectId/geo").get(authorize("analytics", "read"), geoBreakdown)
router.route("/:projectId/security-rule")
    .get(authorize("rule", "read"), getSecurityRule)
    .put(authorize("rule", "update"), updateSecurityRule)
router.route("/:projectId/rules")
    .get(authorize("rule", "read"), getDetectionRules)
    .put(authorize("rule", "update"), updateDetectionRules)

// Environments (Phase 3.4) — scoped under a project.
router.route("/:projectId/environments")
    .get(authorize("environment", "read"), listEnvironments)
    .post(authorize("environment", "create"), createEnvironment)
router.route("/:projectId/environments/:envId")
    .delete(authorize("environment", "delete"), deleteEnvironment)

export default router
