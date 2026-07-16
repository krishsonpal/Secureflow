// Phase 3.3 — tenant isolation integration test (needs Mongo).
// Proves a foreign-org caller is denied READS and WRITES, and that same-org
// least-privilege holds. Creates clearly-marked test data and cleans it up.
// Run: node scripts/test-tenant-isolation.js
import dotenv from "dotenv"
import mongoose from "mongoose"
import crypto from "crypto"
import connectDB from "../src/db/index.js"

import { User } from "../src/models/user.model.js"
import { Organization } from "../src/models/organization.model.js"
import { Team } from "../src/models/team.model.js"
import { Project } from "../src/models/project.model.js"
import { Environment } from "../src/models/environment.model.js"
import { Membership } from "../src/models/membership.model.js"
import { authorize } from "../src/middleware/authorize.js"

dotenv.config({ path: "./.env" })

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error("  ✗", msg) } }
const tag = `isotest-${crypto.randomBytes(4).toString("hex")}`

// Drive an authorize() middleware with a fake req; resolve to the outcome.
const run = (mw, req) => new Promise((resolve) => {
    mw(req, {}, (err) => resolve(err ? { status: err.statuscode || 500 } : { ok: true }))
})
const reqOf = (user, { projectId, body } = {}) => ({
    user, params: projectId ? { projectId: String(projectId) } : {}, body: body || {},
})

const created = []
async function mk(Model, doc) { const d = await Model.create(doc); created.push([Model, d._id]); return d }

async function main() {
    await connectDB()
    let threw = null
    try {
        // --- Org A ---
        const userA = await mk(User, { username: `${tag}-a`, email: `${tag}-a@t.test`, password: "x" })
        const orgA = await mk(Organization, { name: `${tag}-A`, slug: `${tag}-a`, ownerUserId: userA._id })
        userA.organizationId = orgA._id; await userA.save()
        const teamA = await mk(Team, { organizationId: orgA._id, name: "Default", isDefault: true })
        await mk(Membership, { userId: userA._id, organizationId: orgA._id, scopeType: "org", role: "owner" })
        const projA = await mk(Project, { userId: userA._id, organizationId: orgA._id, teamId: teamA._id, projectName: `${tag}-p` })
        await mk(Environment, { projectId: projA._id, organizationId: orgA._id, name: "production", isDefault: true })

        // --- Org B (no access to A) ---
        const userB = await mk(User, { username: `${tag}-b`, email: `${tag}-b@t.test`, password: "x" })
        const orgB = await mk(Organization, { name: `${tag}-B`, slug: `${tag}-b`, ownerUserId: userB._id })
        userB.organizationId = orgB._id; await userB.save()
        await mk(Membership, { userId: userB._id, organizationId: orgB._id, scopeType: "org", role: "owner" })

        // 1) Owner A: allowed on A (read + write).
        ok((await run(authorize("analytics", "read"), reqOf(userA, { projectId: projA._id }))).ok, "A can read own project analytics")
        ok((await run(authorize("rule", "update"), reqOf(userA, { projectId: projA._id }))).ok, "A can update own project rules")

        // 2) Cross-org B → A: denied on READS.
        ok((await run(authorize("analytics", "read"), reqOf(userB, { projectId: projA._id }))).status === 403, "B denied READ of A's analytics (403)")
        ok((await run(authorize("rule", "read"), reqOf(userB, { projectId: projA._id }))).status === 403, "B denied READ of A's rules (403)")

        // 3) Cross-org B → A: denied on WRITES.
        ok((await run(authorize("rule", "update"), reqOf(userB, { projectId: projA._id }))).status === 403, "B denied rule UPDATE on A (403)")
        ok((await run(authorize("project", "delete"), reqOf(userB, { body: { projectId: projA._id } }))).status === 403, "B denied project DELETE on A (403)")
        ok((await run(authorize("apikey", "create"), reqOf(userB, { body: { projectId: projA._id } }))).status === 403, "B denied apikey CREATE on A (403)")

        // 4) Unknown project → 404 (even for a legit user).
        ok((await run(authorize("analytics", "read"), reqOf(userA, { projectId: new mongoose.Types.ObjectId() }))).status === 404, "unknown projectId → 404")

        // 5) Same-org least privilege: grant B read-only in org A.
        await mk(Membership, { userId: userB._id, organizationId: orgA._id, scopeType: "org", role: "read-only" })
        ok((await run(authorize("analytics", "read"), reqOf(userB, { projectId: projA._id }))).ok, "read-only B can now READ A's analytics")
        ok((await run(authorize("project", "delete"), reqOf(userB, { body: { projectId: projA._id } }))).status === 403, "read-only B still denied project DELETE (403)")
    } catch (e) {
        threw = e
    } finally {
        for (const [Model, id] of created.reverse()) { try { await Model.deleteOne({ _id: id }) } catch { /* best effort */ } }
        if (threw) console.error("setup/scenario error:", threw?.message || threw)
        console.log(`\nTenant-isolation tests: ${pass} passed, ${fail} failed (cleaned ${created.length} docs)`)
        await mongoose.disconnect()
        process.exit(fail || threw ? 1 : 0)
    }
}

main().catch(async (e) => { console.error("fatal:", e); try { await mongoose.disconnect() } catch {} process.exit(1) })
