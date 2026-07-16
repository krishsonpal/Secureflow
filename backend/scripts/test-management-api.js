// Phase 3.4 — org/team/member management flow test (needs Mongo).
// Drives the controllers directly (simulating what authorize() sets on req).
// Run: node scripts/test-management-api.js
import dotenv from "dotenv"
import mongoose from "mongoose"
import crypto from "crypto"
import connectDB from "../src/db/index.js"

import { User } from "../src/models/user.model.js"
import { Organization } from "../src/models/organization.model.js"
import { Team } from "../src/models/team.model.js"
import { Membership } from "../src/models/membership.model.js"
import { Invitation } from "../src/models/invitation.model.js"

import { createOrg, listMyOrgs, deleteOrg } from "../src/controllers/org.controller.js"
import { createTeam, listTeams, deleteTeam } from "../src/controllers/team.controller.js"
import { listMembers, inviteMember, acceptInvite, changeMemberRole, removeMember } from "../src/controllers/member.controller.js"

dotenv.config({ path: "./.env" })
process.env.NODE_ENV = process.env.NODE_ENV || "test" // ensure acceptUrl is returned

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗", m) } }
const tag = `mgmttest-${crypto.randomBytes(4).toString("hex")}`

// Resolve on res.json (success) OR next(err) (failure).
const run = (controller, req) => new Promise((resolve) => {
    const res = { statusCode: 200 }
    res.status = (c) => { res.statusCode = c; return res }
    res.json = (body) => { resolve({ status: res.statusCode, body }); return res }
    controller(req, res, (err) => resolve({ status: err?.statuscode || 500, error: err }))
})
// Faithfully rebuild what authorize() puts on req for an org-scoped call.
const asOrg = async (user, orgId, extra = {}) => ({
    user, params: { orgId: String(orgId) }, body: {},
    tenant: { organizationId: orgId },
    memberships: await Membership.find({ userId: user._id, organizationId: orgId }).select("organizationId scopeType teamId projectId role"),
    ...extra,
})

async function main() {
    await connectDB()
    let threw = null
    const orgIds = []
    let userA, userB
    try {
        userA = await User.create({ username: `${tag}-a`, email: `${tag}-a@t.test`, password: "x" })
        userB = await User.create({ username: `${tag}-b`, email: `${tag}-b@t.test`, password: "x" })

        // 1) A creates an org (bootstrap).
        const r1 = await run(createOrg, { user: userA, body: { name: `${tag}-Org` } })
        ok(r1.status === 201, "createOrg 201")
        const orgId = r1.body?.data?._id; orgIds.push(orgId)
        ok(await Membership.exists({ userId: userA._id, organizationId: orgId, scopeType: "org", role: "owner" }), "A has Owner membership")
        ok(await Team.exists({ organizationId: orgId, isDefault: true }), "default team created")

        // 2) listMyOrgs shows it for A, not B.
        const rL = await run(listMyOrgs, { user: userA })
        ok(rL.body?.data?.some((o) => String(o._id) === String(orgId)), "listMyOrgs includes A's org")

        // 3) A invites B as developer.
        const rI = await run(inviteMember, { ...(await asOrg(userA, orgId)), body: { email: userB.email, role: "developer" } })
        ok(rI.status === 201, "inviteMember 201")
        const token = new URL(rI.body?.data?.acceptUrl).searchParams.get("token")
        ok(!!token, "invite returns accept token (dev)")

        // 4) B accepts.
        const rA = await run(acceptInvite, { user: userB, body: { token } })
        ok(rA.status === 200, "acceptInvite 200")
        ok(await Membership.exists({ userId: userB._id, organizationId: orgId, role: "developer" }), "B is now developer")

        // 5) listMembers shows both.
        const rM = await run(listMembers, await asOrg(userA, orgId))
        ok(rM.body?.data?.length === 2, "listMembers = 2")

        // 6) A promotes B to admin.
        const rC = await run(changeMemberRole, { ...(await asOrg(userA, orgId)), params: { orgId: String(orgId), userId: String(userB._id) }, body: { role: "admin" } })
        ok(rC.status === 200 && await Membership.exists({ userId: userB._id, organizationId: orgId, scopeType: "org", role: "admin" }), "B promoted to admin")

        // 7) Owner-only guard: B (admin, not owner) can't grant owner.
        const rO = await run(inviteMember, { ...(await asOrg(userB, orgId)), body: { email: "x@t.test", role: "owner" } })
        ok(rO.status === 403, "admin cannot grant owner role (403)")

        // 8) Last-owner guard: can't remove the only owner (A).
        const rRA = await run(removeMember, { ...(await asOrg(userA, orgId)), params: { orgId: String(orgId), userId: String(userA._id) } })
        ok(rRA.status === 409, "cannot remove last owner (409)")

        // 9) Remove B.
        const rRB = await run(removeMember, { ...(await asOrg(userA, orgId)), params: { orgId: String(orgId), userId: String(userB._id) } })
        ok(rRB.status === 200 && !(await Membership.exists({ userId: userB._id, organizationId: orgId })), "B removed")

        // 10) Teams: create, list, default-delete guard.
        const rT = await run(createTeam, { ...(await asOrg(userA, orgId)), body: { name: "Backend" } })
        ok(rT.status === 201, "createTeam 201")
        const rTL = await run(listTeams, await asOrg(userA, orgId))
        ok(rTL.body?.data?.length === 2, "listTeams = 2 (default + Backend)")
        const defaultTeam = await Team.findOne({ organizationId: orgId, isDefault: true })
        const rTD = await run(deleteTeam, { ...(await asOrg(userA, orgId)), params: { orgId: String(orgId), teamId: String(defaultTeam._id) } })
        ok(rTD.status === 409, "cannot delete default team (409)")
    } catch (e) { threw = e }
    finally {
        for (const orgId of orgIds) {
            await Promise.all([
                Membership.deleteMany({ organizationId: orgId }),
                Team.deleteMany({ organizationId: orgId }),
                Invitation.deleteMany({ organizationId: orgId }),
                Organization.deleteOne({ _id: orgId }),
            ])
        }
        if (userA) await User.deleteOne({ _id: userA._id })
        if (userB) await User.deleteOne({ _id: userB._id })
        if (threw) console.error("error:", threw?.message || threw)
        console.log(`\nManagement-API tests: ${pass} passed, ${fail} failed`)
        await mongoose.disconnect()
        process.exit(fail || threw ? 1 : 0)
    }
}

main().catch(async (e) => { console.error("fatal:", e); try { await mongoose.disconnect() } catch {} process.exit(1) })
