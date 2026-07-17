import Redis from "ioredis"
import { ApiKey } from "../models/apikey.model.js"
import { APIUsage } from "../models/apiusage.model.js"
import { UsageRollup, THREAT_STATUSES } from "../models/usagerollup.model.js"
import { hashToken } from "../utils/tokens.js"
import { maskIp } from "../utils/maskIp.js"
import { resolveGeo } from "../detection/geo.js"
import { USAGE_STREAM, USAGE_GROUP } from "../events/usageStream.js"

const THREAT_SET = new Set(THREAT_STATUSES)

const CONSUMER = `worker-${process.pid}`

let workerRedis
let running = false

const ensureGroup = async (client) => {
    try {
        // "$" = only new messages; MKSTREAM creates the stream if absent.
        await client.xgroup("CREATE", USAGE_STREAM, USAGE_GROUP, "$", "MKSTREAM")
    } catch (e) {
        if (!String(e?.message).includes("BUSYGROUP")) throw e // group already exists is fine
    }
}

const fieldsToObject = (fields) => {
    const obj = {}
    for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1]
    return obj
}

// Persist one usage event + emit to the project's dashboard room. Socket emit is
// best-effort: in a standalone worker process getIO() throws (no in-process io)
// until the Socket.io Redis adapter lands (Part 1.7); we swallow that.
const processEvent = async (fields, emit) => {
    const obj = fieldsToObject(fields)
    if (!obj.apiKey) return

    const keyDoc = await ApiKey.findOne({ key: hashToken(obj.apiKey) }).select("projectId organizationId")
    if (!keyDoc) return

    // Phase 2.1 decision metadata — only present on scored events (empty string
    // otherwise). Persist only when present so legacy/plain events stay clean.
    const usageDoc = {
        apiKey: keyDoc._id,
        projectId: keyDoc.projectId,
        organizationId: keyDoc.organizationId,
        fingerprint: obj.fingerprint,
        status: obj.status,
        message: obj.message
    }
    if (obj.riskScore !== undefined && obj.riskScore !== "") usageDoc.riskScore = Number(obj.riskScore)
    if (obj.action) usageDoc.action = obj.action
    if (obj.topSignal) usageDoc.topSignal = obj.topSignal

    // Phase 3.10 — enrich with geo + a de-identified IP off the hot path. Both
    // fail open to null: geo needs GEOLITE2_CITY_DB (else null → map empty-state)
    // and maskIp honours IP_STORE_MODE. Resolve geo on the RAW ip before masking.
    if (obj.ip) {
        const country = resolveGeo(obj.ip)?.country ?? null
        if (country) usageDoc.country = country
        const storedIp = maskIp(obj.ip)
        if (storedIp) usageDoc.ip = storedIp
    }

    const usage = await APIUsage.create(usageDoc)

    // Maintain the cumulative rollup so the dashboard reads O(1) totals instead
    // of scanning APIUsage. Single atomic upsert; the worker is the sole writer.
    const inc = { totalRequests: 1, [`byStatus.${obj.status}`]: 1 }
    if (THREAT_SET.has(obj.status)) inc.threatsBlocked = 1
    if (obj.status === "rate-limited") inc.rateLimited = 1
    if (obj.action) inc[`byAction.${obj.action}`] = 1
    await UsageRollup.updateOne(
        { projectId: keyDoc.projectId },
        { $inc: inc, $set: { organizationId: keyDoc.organizationId, lastEventAt: new Date() } },
        { upsert: true }
    )

    if (emit) {
        try {
            emit(keyDoc.projectId.toString(), {
                id: usage._id,
                fingerprint: usage.fingerprint,
                status: usage.status,
                message: usage.message,
                timestamp: usage.createdAt
            })
        } catch { /* socket not available in this process */ }
    }
}

const loop = async (emit) => {
    while (running) {
        try {
            const res = await workerRedis.xreadgroup(
                "GROUP", USAGE_GROUP, CONSUMER,
                "COUNT", 20, "BLOCK", 5000,
                "STREAMS", USAGE_STREAM, ">"
            )
            if (!res) continue
            for (const [, entries] of res) {
                for (const [id, fields] of entries) {
                    try {
                        await processEvent(fields, emit)
                        await workerRedis.xack(USAGE_STREAM, USAGE_GROUP, id)
                    } catch (e) {
                        console.error("[usageWorker] process error:", e?.message || e)
                        // leave unacked → redelivered on next XREADGROUP with pending
                    }
                }
            }
        } catch (e) {
            console.error("[usageWorker] loop error:", e?.message || e)
            await new Promise((r) => setTimeout(r, 1000))
        }
    }
}

/**
 * Start the usage-stream consumer.
 * @param {(room, payload) => void} [emit] optional socket emitter (in-process backend passes one)
 */
export const startUsageWorker = async (emit) => {
    if (running) return
    workerRedis = new Redis(process.env.REDIS_URL || undefined)
    workerRedis.on("error", (e) => console.error("[usageWorker] redis error:", e?.message || e))
    await ensureGroup(workerRedis)
    running = true
    console.log(`[usageWorker] started (${CONSUMER}), consuming ${USAGE_STREAM}`)
    loop(emit) // fire the loop; do not await
}

export const stopUsageWorker = async () => {
    running = false
    if (workerRedis) await workerRedis.quit().catch(() => {})
}
