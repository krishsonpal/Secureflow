import { Router } from "express"
import { verifyJWT } from "../middleware/auth.middleware.js"
import { authorize, orgScope } from "../middleware/authorize.js"

import { createOrg, listMyOrgs, getOrg, updateOrg, deleteOrg } from "../controllers/org.controller.js"
import { createTeam, listTeams, updateTeam, deleteTeam } from "../controllers/team.controller.js"
import { listMembers, inviteMember, acceptInvite, changeMemberRole, removeMember } from "../controllers/member.controller.js"

const router = Router()
router.use(verifyJWT)

// Org scope is taken from the :orgId path param (orgScope) so a teamId/projectId
// in the body — which is grant-SCOPE, not the target — can't redirect the check.
const org = (action) => authorize("org", action, { resolveScope: orgScope })
const member = (action) => authorize("member", action, { resolveScope: orgScope })
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

export default router
