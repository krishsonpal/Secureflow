// Phase 3.10 — Dashboard V2 analytics test (needs Mongo). Unit-checks maskIp
// across modes, then drives the search + geo controllers with a faked req.tenant
// (what authorize() would set) over seeded APIUsage rows, including cross-org
// isolation. Run: node scripts/test-analytics.js
import dotenv from "dotenv"
import mongoose from "mongoose"
import crypto from "crypto"
import { app, redis } from "../src/app.js"
import connectDB from "../src/db/index.js"

import { Organization } from "../src/models/organization.model.js"
import { User } from "../src/models/user.model.js"
import { APIUsage } from "../src/models/apiusage.model.js"
import { maskIp } from "../src/utils/maskIp.js"
import { hashToken } from "../src/utils/tokens.js"
import * as A from "../src/controllers/analytics.controller.js"

dotenv.config({ path: "./.env" })

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗", m) } }
const tag = `analytics-${crypto.randomBytes(4).toString("hex")}`

const run = (controller, req) => new Promise((resolve) => {
    const res = { statusCode: 200 }
    res.status = (c) => { res.statusCode = c; return res }
    res.json = (body) => { resolve({ status: res.statusCode, body }); return res }
    controller(req, res, (err) => resolve({ status: err?.statuscode || 500, error: err }))
})

function maskIpUnit() {
    // truncated (default): host anonymized, subnet preserved.
    ok(maskIp("203.0.113.42", "truncated") === "203.0.113.0", "maskIp truncated IPv4 → /24")
    ok(maskIp("::ffff:203.0.113.42", "truncated") === "203.0.113.0", "maskIp truncated IPv4-mapped IPv6 → /24")
    ok(maskIp("2001:db8:abcd:1234:5678:9abc:def0:1234", "truncated") === "2001:db8:abcd:0:0:0:0:0", "maskIp truncated IPv6 → /48")
    // full / none / hash.
    ok(maskIp("203.0.113.42", "full") === "203.0.113.42", "maskIp full → verbatim")
    ok(maskIp("203.0.113.42", "none") === null, "maskIp none → null")
    ok(maskIp("203.0.113.42", "hash") === hashToken("203.0.113.42"), "maskIp hash → sha256")
    // fail-open on junk / empty.
    ok(maskIp("not-an-ip", "truncated") === null, "maskIp junk → null")
    ok(maskIp("", "truncated") === null, "maskIp empty → null")
    ok(maskIp(null, "truncated") === null, "maskIp null → null")
}

async function main() {
    await connectDB()
    let threw = null
    const orgIds = []
    let userA
    try {
        maskIpUnit()

        userA = await User.create({ username: `${tag}-u`, email: `${tag}@t.test`, password: "x" })
        const orgA = await Organization.create({ name: `${tag}-A`, slug: `${tag}-a`, ownerUserId: userA._id })
        const orgB = await Organization.create({ name: `${tag}-B`, slug: `${tag}-b`, ownerUserId: userA._id })
        orgIds.push(orgA._id, orgB._id)
        const projA = new mongoose.Types.ObjectId()
        const projB = new mongoose.Types.ObjectId()
        const keyId = new mongoose.Types.ObjectId()

        const reqA = (query = {}) => ({
            user: userA, params: { projectId: String(projA) }, query,
            tenant: { organizationId: orgA._id, project: { _id: projA } },
        })
        const reqB = (query = {}) => ({
            user: userA, params: { projectId: String(projB) }, query,
            tenant: { organizationId: orgB._id, project: { _id: projB } },
        })

        const now = Date.now()
        const mk = (over) => ({
            apiKey: keyId, organizationId: orgA._id, projectId: projA,
            fingerprint: "fpX", status: "success", createdAt: new Date(now), ...over,
        })
        // Seed a varied set in org A / project A.
        await APIUsage.create([
            mk({ status: "sqli", action: "block", riskScore: 90, country: "US", ip: "203.0.113.0", message: "sqli blocked", createdAt: new Date(now - 1000) }),
            mk({ status: "xss", action: "block", riskScore: 80, country: "US", ip: "203.0.113.0", message: "xss blocked", createdAt: new Date(now - 2000) }),
            mk({ status: "ssrf", action: "challenge", riskScore: 55, country: "DE", ip: "198.51.100.0", message: "ssrf challenge", createdAt: new Date(now - 3000) }),
            mk({ status: "reputation", action: "block", riskScore: 65, country: "DE", ip: "198.51.100.0", message: "bad reputation", createdAt: new Date(now - 4000) }),
            mk({ status: "success", action: "allow", riskScore: 5, country: null, ip: "192.0.2.0", message: "ok", createdAt: new Date(now - 5000) }),
            mk({ status: "sqli", action: "block", riskScore: 95, country: "IN", ip: "203.0.113.0", message: "old sqli", createdAt: new Date(now - 48 * 3600 * 1000) }),
        ])
        // Seed org B / project B — must never appear in org A reads.
        await APIUsage.create({ apiKey: keyId, organizationId: orgB._id, projectId: projB, status: "sqli", action: "block", riskScore: 99, country: "US", ip: "203.0.113.0", message: "orgB sqli" })

        // --- searchEvents ---
        const all = await run(A.searchEvents, reqA())
        ok(all.status === 200, "searchEvents 200")
        ok(all.body.data.events.length === 6, "searchEvents returns all 6 org-A rows")
        ok(all.body.data.events[0].message === "sqli blocked", "searchEvents newest-first")

        const byStatus = await run(A.searchEvents, reqA({ status: "sqli" }))
        ok(byStatus.body.data.events.length === 2, "filter status=sqli → 2")

        const byAction = await run(A.searchEvents, reqA({ action: "block" }))
        ok(byAction.body.data.events.every((e) => e.action === "block"), "filter action=block")
        ok(byAction.body.data.events.length === 4, "filter action=block → 4")

        const byRisk = await run(A.searchEvents, reqA({ riskMin: "80" }))
        ok(byRisk.body.data.events.length === 3, "filter riskMin=80 → 3 (90,80,95)")

        const byRiskRange = await run(A.searchEvents, reqA({ riskMin: "50", riskMax: "70" }))
        ok(byRiskRange.body.data.events.length === 2, "filter risk 50-70 → 2 (55,65)")

        const byQ = await run(A.searchEvents, reqA({ q: "challenge" }))
        ok(byQ.body.data.events.length === 1 && byQ.body.data.events[0].status === "ssrf", "free-text q=challenge → ssrf row")

        // ip filter is normalized through maskIp — a full IP finds its /24 row.
        const byIp = await run(A.searchEvents, reqA({ ip: "203.0.113.42" }))
        ok(byIp.body.data.events.length === 3, "ip filter normalized to /24 → 3 rows (203.0.113.0)")

        // from-window excludes the 48h-old row.
        const recent = await run(A.searchEvents, reqA({ from: new Date(now - 24 * 3600 * 1000).toISOString() }))
        ok(recent.body.data.events.length === 5, "from=24h ago → 5 (excludes 48h-old)")

        // pagination: limit + before cursor.
        const p1 = await run(A.searchEvents, reqA({ limit: "2" }))
        ok(p1.body.data.events.length === 2 && p1.body.data.nextBefore, "page 1: 2 rows + cursor")
        const p2 = await run(A.searchEvents, reqA({ limit: "2", before: new Date(p1.body.data.nextBefore).toISOString() }))
        ok(p2.body.data.events.length === 2, "page 2: 2 more rows")
        ok(p2.body.data.events[0].message !== p1.body.data.events[0].message, "page 2 distinct from page 1")

        // --- geoBreakdown ---
        const geo = await run(A.geoBreakdown, reqA({ hours: "24" }))
        ok(geo.status === 200, "geoBreakdown 200")
        const gmap = Object.fromEntries(geo.body.data.breakdown.map((r) => [r.country, r.count]))
        ok(gmap.US === 2, "geo US=2 (sqli+xss, threat only)")
        ok(gmap.DE === 2, "geo DE=2 (ssrf+reputation)")
        ok(!("IN" in gmap), "geo excludes IN (48h-old, outside 24h window)")
        ok(geo.body.data.breakdown.every((r) => r.country), "geo drops null-country buckets")
        ok(geo.body.data.breakdown[0].count >= geo.body.data.breakdown[geo.body.data.breakdown.length - 1].count, "geo sorted desc")

        // --- cross-org isolation ---
        const isoEvents = await run(A.searchEvents, reqB())
        ok(isoEvents.body.data.events.length === 1 && isoEvents.body.data.events[0].message === "orgB sqli", "org B sees only its own event")
        const isoGeo = await run(A.geoBreakdown, reqB({ hours: "24" }))
        ok(isoGeo.body.data.breakdown.length === 1 && isoGeo.body.data.breakdown[0].country === "US" && isoGeo.body.data.breakdown[0].count === 1, "org B geo isolated (US=1)")
    } catch (e) { threw = e }
    finally {
        for (const orgId of orgIds) {
            await Promise.all([
                APIUsage.deleteMany({ organizationId: orgId }),
                Organization.deleteOne({ _id: orgId }),
            ])
        }
        if (userA) await User.deleteOne({ _id: userA._id })
        if (threw) console.error("error:", threw?.message || threw)
        console.log(`\nAnalytics tests: ${pass} passed, ${fail} failed`)
        await mongoose.disconnect().catch(() => {})
        await redis.quit().catch(() => {})
        process.exit(fail || threw ? 1 : 0)
    }
}

main().catch(async (e) => { console.error("fatal:", e); process.exit(1) })
