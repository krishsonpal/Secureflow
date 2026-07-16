// Phase 3.8 — alert management API test (needs Mongo). Drives the controllers
// with a faked req.tenant (what authorize() would set). Run: node scripts/test-alert-api.js
import dotenv from "dotenv"
import mongoose from "mongoose"
import crypto from "crypto"
// Load app.js FIRST so the router graph (org.routes → alert.controller) wires
// fully before we import the controller directly — matches the real server's
// load order (index.js imports app.js first) and avoids a circular-init TDZ.
import { app, redis } from "../src/app.js"
import connectDB from "../src/db/index.js"

import { Organization } from "../src/models/organization.model.js"
import { User } from "../src/models/user.model.js"
import { AlertChannel } from "../src/models/alertchannel.model.js"
import { AlertRule } from "../src/models/alertrule.model.js"
import { Alert } from "../src/models/alert.model.js"
import * as C from "../src/controllers/alert.controller.js"

dotenv.config({ path: "./.env" })

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗", m) } }
const tag = `alertapi-${crypto.randomBytes(4).toString("hex")}`

const run = (controller, req) => new Promise((resolve) => {
    const res = { statusCode: 200 }
    res.status = (c) => { res.statusCode = c; return res }
    res.json = (body) => { resolve({ status: res.statusCode, body }); return res }
    controller(req, res, (err) => resolve({ status: err?.statuscode || 500, error: err }))
})

async function main() {
    await connectDB()
    let threw = null
    const orgIds = []
    let userA
    try {
        userA = await User.create({ username: `${tag}-u`, email: `${tag}@t.test`, password: "x" })
        const orgA = await Organization.create({ name: `${tag}-A`, slug: `${tag}-a`, ownerUserId: userA._id })
        const orgB = await Organization.create({ name: `${tag}-B`, slug: `${tag}-b`, ownerUserId: userA._id })
        orgIds.push(orgA._id, orgB._id)
        const reqA = (extra = {}) => ({ user: userA, params: { orgId: String(orgA._id) }, body: {}, query: {}, tenant: { organizationId: orgA._id }, ...extra })
        const reqB = (extra = {}) => ({ user: userA, params: { orgId: String(orgB._id) }, body: {}, query: {}, tenant: { organizationId: orgB._id }, ...extra })

        // 1) Create channel.
        const rc = await run(C.createChannel, reqA({ body: { name: "ops-webhook", type: "webhook", config: { url: "http://127.0.0.1:1/x" } } }))
        ok(rc.status === 201, "createChannel 201")
        const channelId = rc.body?.data?._id

        // 2) Create rule referencing the channel.
        const rr = await run(C.createRule, reqA({ body: {
            name: "sqli-critical", severity: "critical",
            conditions: { any: [{ fact: "status", operator: "in", value: ["sqli", "xss"] }] },
            channelIds: [String(channelId)],
        } }))
        ok(rr.status === 201, "createRule 201")
        const ruleId = rr.body?.data?._id

        // 3) Bad conditions → 400.
        const rBad = await run(C.createRule, reqA({ body: { name: "bad", conditions: { fact: "status", operator: "nope", value: 1 } } }))
        ok(rBad.status === 400, "createRule bad conditions → 400")

        // 4) channelId from another org / nonexistent → 400.
        const rBadCh = await run(C.createRule, reqA({ body: { name: "badch", conditions: { any: [{ fact: "status", operator: "in", value: ["sqli"] }] }, channelIds: [String(new mongoose.Types.ObjectId())] } }))
        ok(rBadCh.status === 400, "createRule foreign channelId → 400")

        // 5) List.
        ok((await run(C.listChannels, reqA())).body?.data?.length === 1, "listChannels = 1")
        ok((await run(C.listRules, reqA())).body?.data?.length === 1, "listRules = 1")

        // 6) A fired alert → ack → resolve.
        const alert = await Alert.create({ organizationId: orgA._id, alertRuleId: ruleId, severity: "critical", status: "open", title: "t", dedupKey: `${ruleId}:fp`, context: { status: "sqli" } })
        ok((await run(C.listAlerts, reqA())).body?.data?.some((a) => String(a._id) === String(alert._id)), "listAlerts shows the alert")
        ok((await run(C.acknowledgeAlert, reqA({ params: { orgId: String(orgA._id), alertId: String(alert._id) } }))).body?.data?.status === "acknowledged", "ack → acknowledged")
        ok((await run(C.resolveAlert, reqA({ params: { orgId: String(orgA._id), alertId: String(alert._id) } }))).body?.data?.status === "resolved", "resolve → resolved")

        // 7) Cross-org isolation (tenantRepo).
        ok((await run(C.acknowledgeAlert, reqB({ params: { orgId: String(orgB._id), alertId: String(alert._id) } }))).status === 404, "org B cannot ack org A's alert (404)")
        ok((await run(C.listRules, reqB())).body?.data?.length === 0, "org B sees none of A's rules")
        ok((await run(C.listChannels, reqB())).body?.data?.length === 0, "org B sees none of A's channels")

        // 8) Delete channel → pulled from the rule's channelIds.
        ok((await run(C.deleteChannel, reqA({ params: { orgId: String(orgA._id), channelId: String(channelId) } }))).status === 200, "deleteChannel 200")
        const ruleAfter = await AlertRule.findById(ruleId)
        ok(!ruleAfter.channelIds.map(String).includes(String(channelId)), "channel ref pulled from rule")

        // 9) Delete rule.
        ok((await run(C.deleteRule, reqA({ params: { orgId: String(orgA._id), ruleId: String(ruleId) } }))).status === 200, "deleteRule 200")
    } catch (e) { threw = e }
    finally {
        for (const orgId of orgIds) {
            await Promise.all([
                AlertChannel.deleteMany({ organizationId: orgId }),
                AlertRule.deleteMany({ organizationId: orgId }),
                Alert.deleteMany({ organizationId: orgId }),
                Organization.deleteOne({ _id: orgId }),
            ])
        }
        if (userA) await User.deleteOne({ _id: userA._id })
        if (threw) console.error("error:", threw?.message || threw)
        console.log(`\nAlert-API tests: ${pass} passed, ${fail} failed`)
        await mongoose.disconnect().catch(() => {})
        await redis.quit().catch(() => {})
        process.exit(fail || threw ? 1 : 0)
    }
}

main().catch(async (e) => { console.error("fatal:", e); process.exit(1) })
