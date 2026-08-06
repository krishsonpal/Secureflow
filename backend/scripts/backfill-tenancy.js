// Phase 3.1 — one-time tenancy backfill + referential-integrity check.
//
// Existing data predates the Org→Team→Project→Environment tree: users may lack
// an org, projects lack a team/environment, keys lack an environment. This
// script lays the full chain in so 3.3's org-scoped queries always resolve, then
// runs a FAIL-LOUD integrity pass so any orphan surfaces immediately.
//
// Safe to re-run (idempotent): everything is "ensure", never blind-create.
// Run from the backend dir:  node scripts/backfill-tenancy.js   (or npm run backfill:tenancy)

import dotenv from "dotenv"
import mongoose from "mongoose"
import crypto from "crypto"
import connectDB from "../src/db/index.js"

import { User } from "../src/models/user.model.js"
import { Organization } from "../src/models/organization.model.js"
import { Team } from "../src/models/team.model.js"
import { Project } from "../src/models/project.model.js"
import { Environment } from "../src/models/environment.model.js"
import { ApiKey } from "../src/models/apikey.model.js"
import { Membership } from "../src/models/membership.model.js"

dotenv.config({ path: "./.env" })

const NIL = [null, undefined]
const isSet = (v) => !NIL.includes(v)
const slugify = (name) =>
    `${String(name || "org").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "org"}-${crypto.randomBytes(3).toString("hex")}`

// ---- ensure helpers --------------------------------------------------------

async function ensureOrgForUser(user) {
    // Prefer an org the user already points at or already owns.
    if (isSet(user.organizationId)) {
        const existing = await Organization.findById(user.organizationId)
        if (existing) return existing
    }
    let org = await Organization.findOne({ ownerUserId: user._id })
    if (!org) {
        org = await Organization.create({
            name: `${user.username || "user"}'s Organization`,
            slug: slugify(user.username),
            plan: "free",
            ownerUserId: user._id,
        })
    }
    if (!isSet(org.slug)) { org.slug = slugify(org.name); await org.save() }
    if (!isSet(user.organizationId) || String(user.organizationId) !== String(org._id)) {
        user.organizationId = org._id
        await user.save()
    }
    return org
}

async function ensureDefaultTeam(organizationId) {
    let team = await Team.findOne({ organizationId, isDefault: true })
    if (!team) team = await Team.create({ organizationId, name: "Default", isDefault: true })
    return team
}

async function ensureOwnerMembership(userId, organizationId) {
    await Membership.updateOne(
        { userId, organizationId, scopeType: "org", teamId: null, projectId: null },
        { $setOnInsert: { userId, organizationId, scopeType: "org", role: "owner" } },
        { upsert: true }
    )
}

async function ensureDefaultEnv(projectId, organizationId) {
    let env = await Environment.findOne({ projectId, isDefault: true })
    if (!env) return Environment.create({ projectId, organizationId, name: "production", isDefault: true })
    // Heal a stale denormalized org (e.g. env created under a since-corrected org).
    if (String(env.organizationId || "") !== String(organizationId)) {
        env.organizationId = organizationId
        await env.save()
    }
    return env
}

// ---- main ------------------------------------------------------------------

async function run() {
    await connectDB()
    const stats = { orgs: 0, teams: 0, memberships: 0, projects: 0, envs: 0, keys: 0, stamped: 0 }

    // 1) Users → ensure each has a (valid) home org.
    const users = await User.find({})
    for (const user of users) {
        await ensureOrgForUser(user); stats.orgs++
    }

    // 1b) Every org (not just each user's primary — a user can own several) gets
    //     a default team + an Owner membership for its ownerUserId. This heals
    //     extra/orphan orgs that step 1 wouldn't touch.
    for (const org of await Organization.find({})) {
        await ensureDefaultTeam(org._id); stats.teams++
        if (isSet(org.ownerUserId)) { await ensureOwnerMembership(org.ownerUserId, org._id); stats.memberships++ }
    }

    // 2) Projects → organizationId + teamId + default environment.
    const projects = await Project.find({})
    for (const project of projects) {
        // Trust project.organizationId only if it still resolves to a real org;
        // a stale/dangling ref must be re-derived from the (now-healed) owner.
        let orgId = isSet(project.organizationId) && await Organization.exists({ _id: project.organizationId })
            ? project.organizationId
            : null
        if (!isSet(orgId) && isSet(project.userId)) {
            const owner = await User.findById(project.userId)
            orgId = owner?.organizationId
        }
        if (!isSet(orgId)) {
            console.warn(`[backfill] project ${project._id} has no resolvable org (owner missing/deleted) — skipping`)
            continue
        }
        const team = await ensureDefaultTeam(orgId)
        const env = await ensureDefaultEnv(project._id, orgId); stats.envs++

        const set = {}
        // Overwrite when missing OR stale (didn't match the resolved valid org).
        if (String(project.organizationId || "") !== String(orgId)) set.organizationId = orgId
        // Re-point teamId when missing or stale (points outside the resolved org).
        // At backfill everything lands in the org's default team.
        if (String(project.teamId || "") !== String(team._id)) set.teamId = team._id
        if (Object.keys(set).length) { await Project.updateOne({ _id: project._id }, { $set: set }); stats.stamped++ }
        stats.projects++

        // 3) API keys under this project → organizationId + environmentId.
        await ApiKey.updateMany(
            { projectId: project._id, organizationId: { $in: NIL } },
            { $set: { organizationId: orgId } }
        )
        const keyRes = await ApiKey.updateMany(
            { projectId: project._id, environmentId: { $in: NIL } },
            { $set: { environmentId: env._id } }
        )
        stats.keys += keyRes.modifiedCount || 0

        // 4) Stamp organizationId on the project's event/rollup/rule/client rows
        //    (bulk, only where missing) so tenant filtering works everywhere.
        for (const Model of await tenantStampModels()) {
            await Model.updateMany(
                { projectId: project._id, organizationId: { $in: NIL } },
                { $set: { organizationId: orgId } }
            )
        }
    }

    // Clean up dangling artifacts: teams/envs pointing at an org that no longer
    // exists (e.g. created under a stale org ref before healing re-pointed the
    // projects). After re-pointing above, nothing references these.
    const liveOrgIds = (await Organization.find({}, "_id")).map((o) => o._id)
    const delTeams = await Team.deleteMany({ organizationId: { $nin: liveOrgIds } })
    const delEnvs = await Environment.deleteMany({ organizationId: { $nin: liveOrgIds } })
    if (delTeams.deletedCount || delEnvs.deletedCount) {
        console.log(`[backfill] cleaned orphans: ${delTeams.deletedCount} team(s), ${delEnvs.deletedCount} env(s)`)
    }

    console.log("[backfill] done:", JSON.stringify(stats))
    const ok = await integrityCheck()
    await mongoose.disconnect()
    if (!ok) process.exit(1)
}

// Loaded lazily so a missing optional model never breaks the core backfill.
async function tenantStampModels() {
    const mods = []
    for (const path of [
        "../src/models/apiusage.model.js",
        "../src/models/usagerollup.model.js",
        "../src/models/detectionrule.model.js",
        "../src/models/clientuser.model.js",
        "../src/models/securityrule.model.js",
    ]) {
        try {
            const m = await import(path)
            const model = m.APIUsage || m.UsageRollup || m.DetectionRule || m.ClientUser || m.SecurityRule ||
                m[Object.keys(m).find((k) => m[k]?.modelName)]
            if (model) mods.push(model)
        } catch { /* optional */ }
    }
    return mods
}

// ---- fail-loud referential-integrity pass ----------------------------------

async function integrityCheck() {
    const problems = []

    const orgIds = new Set((await Organization.find({}, "_id")).map((o) => String(o._id)))
    const teams = await Team.find({}, "_id organizationId")
    const teamOrg = new Map(teams.map((t) => [String(t._id), String(t.organizationId)]))
    const projects = await Project.find({}, "_id organizationId teamId")
    const projOrg = new Map(projects.map((p) => [String(p._id), String(p.organizationId)]))

    // Teams → valid org.
    for (const t of teams) {
        if (!orgIds.has(String(t.organizationId))) problems.push(`team ${t._id} → missing org ${t.organizationId}`)
    }
    // Projects → valid org + team (team in same org).
    for (const p of projects) {
        if (!isSet(p.organizationId) || !orgIds.has(String(p.organizationId))) problems.push(`project ${p._id} → invalid/missing org`)
        if (!isSet(p.teamId)) problems.push(`project ${p._id} → missing teamId`)
        else if (teamOrg.get(String(p.teamId)) !== String(p.organizationId)) problems.push(`project ${p._id} → team not in its org`)
    }
    // Environments → valid project + org matches project's.
    for (const e of await Environment.find({}, "_id projectId organizationId")) {
        if (!isSet(e.projectId) || !projOrg.has(String(e.projectId))) problems.push(`env ${e._id} → invalid/missing project`)
        else if (String(e.organizationId) !== projOrg.get(String(e.projectId))) problems.push(`env ${e._id} → org mismatch with project`)
    }
    // API keys → valid environment whose project matches the key's project.
    const envById = new Map((await Environment.find({}, "_id projectId")).map((e) => [String(e._id), String(e.projectId)]))
    for (const k of await ApiKey.find({}, "_id projectId environmentId")) {
        if (!isSet(k.environmentId)) problems.push(`apikey ${k._id} → missing environmentId`)
        else if (envById.get(String(k.environmentId)) !== String(k.projectId)) problems.push(`apikey ${k._id} → env not in key's project`)
    }
    // Every org owner has an Owner membership.
    for (const org of await Organization.find({}, "_id ownerUserId")) {
        const has = await Membership.exists({ userId: org.ownerUserId, organizationId: org._id, scopeType: "org", role: "owner" })
        if (!has) problems.push(`org ${org._id} → owner ${org.ownerUserId} has no Owner membership`)
    }

    if (problems.length) {
        console.error(`[backfill] INTEGRITY FAILED — ${problems.length} problem(s):`)
        for (const p of problems.slice(0, 50)) console.error("  -", p)
        return false
    }
    console.log("[backfill] integrity OK — zero orphans")
    return true
}

run().catch((err) => {
    console.error("[backfill] fatal:", err?.message || err)
    process.exit(1)
})
