// Threat-intel worker (Phase 2.6).
//
// A SECOND consumer group on the existing stream:usage — it reads the same usage
// events as the usage worker but with an independent cursor, so it never disturbs
// usage-workers' rollups. For every event that represents an attack (status in
// THREAT_STATUSES) it: (1) bumps the Redis reputation counters (recordAttack) so
// the decision path can flag repeat offenders, and (2) upserts the Mongo
// threat-intel history keyed by IP (sole writer, like UsageRollup).
//
// Mirrors usageWorker.js: own blocking Redis connection, consumer group with
// MKSTREAM, BLOCK-poll loop, leave-unacked-on-error, running-flag lifecycle.

import Redis from "ioredis";
import { ThreatIntel } from "../models/threatintel.model.js";
import { THREAT_STATUSES } from "../models/usagerollup.model.js";
import { USAGE_STREAM } from "../events/usageStream.js";
import { recordAttack } from "../detection/reputation.js";
import { resolveGeo } from "../detection/geo.js";

const THREAT_SET = new Set(THREAT_STATUSES);
const GROUP = "threatintel-workers";
const CONSUMER = `ti-worker-${process.pid}`;

let workerRedis;
let running = false;

const ensureGroup = async (client) => {
    try {
        await client.xgroup("CREATE", USAGE_STREAM, GROUP, "$", "MKSTREAM");
    } catch (e) {
        if (!String(e?.message).includes("BUSYGROUP")) throw e;
    }
};

const fieldsToObject = (fields) => {
    const obj = {};
    for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
    return obj;
};

const processEvent = async (fields) => {
    const obj = fieldsToObject(fields);
    if (!THREAT_SET.has(obj.status)) return; // only attacks build reputation
    const ip = obj.ip || "";
    const fingerprint = obj.fingerprint || "";
    if (!ip && !fingerprint) return;

    // Hot store: decaying reputation counters used by the decision path.
    await recordAttack({ ip, fingerprint });

    // History: one doc per IP. Enrich with geo/asn (off the hot path, so an
    // inline GeoLite2 lookup is fine; null when the db isn't configured).
    if (ip) {
        const geo = resolveGeo(ip) || {};
        const nowDate = new Date();
        await ThreatIntel.updateOne(
            { ip },
            {
                $inc: { count: 1 },
                $set: {
                    fingerprint,
                    detector: obj.topSignal || obj.status,
                    country: geo.country ?? undefined,
                    asn: geo.asn ?? undefined,
                    lastSeen: nowDate,
                },
                $setOnInsert: { firstSeen: nowDate },
            },
            { upsert: true }
        );
    }
};

const loop = async () => {
    while (running) {
        try {
            const res = await workerRedis.xreadgroup(
                "GROUP", GROUP, CONSUMER,
                "COUNT", 20, "BLOCK", 5000,
                "STREAMS", USAGE_STREAM, ">"
            );
            if (!res) continue;
            for (const [, entries] of res) {
                for (const [id, fields] of entries) {
                    try {
                        await processEvent(fields);
                        await workerRedis.xack(USAGE_STREAM, GROUP, id);
                    } catch (e) {
                        console.error("[threatIntelWorker] process error:", e?.message || e);
                        // leave unacked → redelivered
                    }
                }
            }
        } catch (e) {
            console.error("[threatIntelWorker] loop error:", e?.message || e);
            await new Promise((r) => setTimeout(r, 1000));
        }
    }
};

export const startThreatIntelWorker = async () => {
    if (running) return;
    workerRedis = new Redis(process.env.REDIS_URL || undefined);
    workerRedis.on("error", (e) => console.error("[threatIntelWorker] redis error:", e?.message || e));
    await ensureGroup(workerRedis);
    running = true;
    console.log(`[threatIntelWorker] started (${CONSUMER}), consuming ${USAGE_STREAM}`);
    loop(); // fire; do not await
};

export const stopThreatIntelWorker = async () => {
    running = false;
    if (workerRedis) await workerRedis.quit().catch(() => {});
};
