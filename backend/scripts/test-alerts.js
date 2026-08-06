// Phase 3.7 — alert evaluation + dedup/grouping test (needs Redis + Mongo).
// Exercises evaluateEvent directly with an injected capturing dispatch (no real
// SMTP/HTTP). Run: node scripts/test-alerts.js
import dotenv from "dotenv"
import mongoose from "mongoose"
import crypto from "crypto"
import connectDB from "../src/db/index.js"

import { Organization } from "../src/models/organization.model.js"
import { AlertRule } from "../src/models/alertrule.model.js"
import { AlertChannel } from "../src/models/alertchannel.model.js"
import { Alert } from "../src/models/alert.model.js"
import { evaluateEvent } from "../src/alerts/evaluate.js"
import { _clearAlertRuleCache } from "../src/utils/alertRules.js"
import { redis } from "../src/app.js"

dotenv.config({ path: "./.env" })

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗", m) } }
const tag = `alerttest-${crypto.randomBytes(4).toString("hex")}`

async function main() {
    await connectDB()
    let threw = null
    const cleanup = []
    try {
        const org = await Organization.create({ name: `${tag}-org`, slug: tag, ownerUserId: new mongoose.Types.ObjectId() })
        cleanup.push(() => Organization.deleteOne({ _id: org._id }))
        const channel = await AlertChannel.create({ organizationId: org._id, name: `${tag}-ch`, type: "webhook", config: { url: "http://example.invalid/hook" }, enabled: true })
        cleanup.push(() => AlertChannel.deleteOne({ _id: channel._id }))
        const rule = await AlertRule.create({
            organizationId: org._id, projectId: null, name: `${tag}-rule`, enabled: true, severity: "critical",
            conditions: { any: [
                { fact: "status", operator: "in", value: ["sqli", "xss"] },
                { fact: "riskScore", operator: "greaterThanInclusive", value: 70 },
            ] },
            channelIds: [channel._id], dedupBy: "fingerprint", dedupWindowSec: 60,
        })
        cleanup.push(() => AlertRule.deleteOne({ _id: rule._id }))
        cleanup.push(() => Alert.deleteMany({ organizationId: org._id }))
        cleanup.push(() => redis.del(`alert:dd:${rule._id}:fp1`, `alert:dd:${rule._id}:fp3`))
        _clearAlertRuleCache()

        let calls = 0
        const dispatch = async () => { calls++; return { ok: true } }
        const evt = (over) => ({ organizationId: String(org._id), projectId: null, status: "sqli", fingerprint: "fp1", riskScore: "90", ...over })

        // 1) First matching event → alert created + dispatched once.
        const r1 = await evaluateEvent({ event: evt(), dispatch })
        ok(r1.matched === 1 && r1.notified === 1, "first event matched + notified")
        ok(calls === 1, "dispatch called once")
        const a1 = await Alert.findOne({ organizationId: org._id, dedupKey: `${rule._id}:fp1` })
        ok(a1 && a1.count === 1 && a1.severity === "critical" && a1.status === "open", "grouped Alert opened (count 1)")

        // 2) Same event within window → grouped (count++), NOT re-notified.
        const r2 = await evaluateEvent({ event: evt(), dispatch })
        ok(r2.matched === 1 && r2.notified === 0, "repeat matched but suppressed")
        ok(calls === 1, "dispatch NOT called again (dedup window)")
        const a2 = await Alert.findOne({ organizationId: org._id, dedupKey: `${rule._id}:fp1` })
        ok(a2.count === 2, "Alert count incremented to 2")

        // 3) Non-matching event → nothing.
        const r3 = await evaluateEvent({ event: evt({ status: "bot", riskScore: "10", fingerprint: "fp2" }), dispatch })
        ok(r3.matched === 0 && r3.notified === 0 && calls === 1, "non-matching event ignored")

        // 4) Snooze → matches + groups but never notifies.
        await AlertRule.updateOne({ _id: rule._id }, { $set: { snoozedUntil: new Date(Date.now() + 3600e3) } })
        _clearAlertRuleCache()
        const r4 = await evaluateEvent({ event: evt({ fingerprint: "fp3" }), dispatch })
        ok(r4.matched === 1 && r4.notified === 0 && calls === 1, "snoozed rule matches but does not notify")
        ok(await Alert.findOne({ organizationId: org._id, dedupKey: `${rule._id}:fp3` }), "snoozed match still records a grouped alert")
    } catch (e) { threw = e }
    finally {
        for (const fn of cleanup.reverse()) { try { await fn() } catch { /* best effort */ } }
        if (threw) console.error("error:", threw?.message || threw)
        console.log(`\nAlert-eval tests: ${pass} passed, ${fail} failed`)
        await mongoose.disconnect().catch(() => {})
        await redis.quit().catch(() => {})
        process.exit(fail || threw ? 1 : 0)
    }
}

main().catch(async (e) => { console.error("fatal:", e); process.exit(1) })
