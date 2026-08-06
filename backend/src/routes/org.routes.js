import { Router } from "express"
import { verifyJWT } from "../middleware/auth.middleware.js"
import { authorize, orgScope } from "../middleware/authorize.js"

import { createOrg, listMyOrgs, getOrg, updateOrg, deleteOrg } from "../controllers/org.controller.js"
import { createTeam, listTeams, updateTeam, deleteTeam } from "../controllers/team.controller.js"
import { listMembers, inviteMember, acceptInvite, changeMemberRole, removeMember } from "../controllers/member.controller.js"
import {
    listChannels, createChannel, updateChannel, deleteChannel, testChannel,
    listRules, createRule, updateRule, deleteRule,
    listAlerts, acknowledgeAlert, resolveAlert,
} from "../controllers/alert.controller.js"

const router = Router()
router.use(verifyJWT)

// Org scope is taken from the :orgId path param (orgScope) so a teamId/projectId
// in the body — which is grant-SCOPE, not the target — can't redirect the check.
const org = (action) => authorize("org", action, { resolveScope: orgScope })
const member = (action) => authorize("member", action, { resolveScope: orgScope })
// Alerting is org-scoped; a projectId in a rule body is grant-scope, not the
// target — so use orgScope (not the default body-aware resolver).
const alert = (action) => authorize("alert", action, { resolveScope: orgScope })
// Teams use the default resolver: :teamId loads the team (so team-scoped grants
// resolve), and team bodies never carry a projectId to hijack the target.
const team = (action) => authorize("team", action)

// Bootstrap + listing (no existing tenant to authorize against).
router.route("/").post(createOrg).get(listMyOrgs)
// Redeem an invite (any authenticated user with a valid token).
router.route("/invites/accept").post(acceptInvite)

// Org lifecycle.
router.route("/:orgId")
    .get(org("read"), getOrg)
    .patch(org("update"), updateOrg)
    .delete(org("delete"), deleteOrg)

// Teams.
router.route("/:orgId/teams")
    .get(team("read"), listTeams)
    .post(team("create"), createTeam)
router.route("/:orgId/teams/:teamId")
    .patch(team("update"), updateTeam)
    .delete(team("delete"), deleteTeam)

// Members — invite route registered BEFORE :userId so "invite" isn't captured.
router.route("/:orgId/members").get(member("read"), listMembers)
router.route("/:orgId/members/invite").post(member("create"), inviteMember)
router.route("/:orgId/members/:userId")
    .patch(member("update"), changeMemberRole)
    .delete(member("delete"), removeMember)

// Alerting (Phase 3.8) — channels, rules, alert center.
router.route("/:orgId/alert-channels")
    .get(alert("read"), listChannels)
    .post(alert("create"), createChannel)
router.route("/:orgId/alert-channels/:channelId")
    .patch(alert("update"), updateChannel)
    .delete(alert("delete"), deleteChannel)
router.route("/:orgId/alert-channels/:channelId/test").post(alert("update"), testChannel)

router.route("/:orgId/alert-rules")
    .get(alert("read"), listRules)
    .post(alert("create"), createRule)
router.route("/:orgId/alert-rules/:ruleId")
    .patch(alert("update"), updateRule)
    .delete(alert("delete"), deleteRule)

router.route("/:orgId/alerts").get(alert("read"), listAlerts)
router.route("/:orgId/alerts/:alertId/ack").patch(alert("update"), acknowledgeAlert)
router.route("/:orgId/alerts/:alertId/resolve").patch(alert("update"), resolveAlert)

export default router
