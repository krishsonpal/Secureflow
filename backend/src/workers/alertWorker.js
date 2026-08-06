// Alert worker (Phase 3.7).
//
// A THIRD consumer group on stream:usage (after usage-workers and
// threatintel-workers) — independent cursor, so it never disturbs the others.
// For every threat event it resolves the tenant from the API key (sliding-TTL
// cache) and evaluates the org's alert rules → grouped Alert + notifications.
// Entirely off the hot path. Mirrors workers/threatIntelWorker.js.

import Redis from "ioredis";
import { THREAT_STATUSES } from "../models/usagerollup.model.js";
import { USAGE_STREAM } from "../events/usageStream.js";
import { hashToken } from "../utils/tokens.js";
import { resolveKeyTenant } from "../utils/keyTenant.js";
import { evaluateEvent } from "../alerts/evaluate.js";

const THREAT_SET = new Set(THREAT_STATUSES);
const GROUP = "alert-workers";
const CONSUMER = `alert-worker-${process.pid}`;

let workerRedis;
let running = false;
let emitFn = null;

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
    if (!THREAT_SET.has(obj.status)) return; // only threats can raise alerts
    if (!obj.apiKey) return;

    const apiKeyHash = hashToken(obj.apiKey);
    const tenant = await resolveKeyTenant(apiKeyHash);
    if (!tenant?.organizationId) return; // unknown/removed key → nothing to scope to

    await evaluateEvent({
        event: {
            organizationId: tenant.organizationId,
            projectId: tenant.projectId,
            environmentId: tenant.environmentId,
            identity: apiKeyHash,
            status: obj.status,
            riskScore: obj.riskScore,
            action: obj.action,
            topSignal: obj.topSignal,
            ip: obj.ip,
            fingerprint: obj.fingerprint,
        },
        emit: emitFn,
    });
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
                        console.error("[alertWorker] process error:", e?.message || e);
                        // leave unacked → redelivered
                    }
                }
            }
        } catch (e) {
            console.error("[alertWorker] loop error:", e?.message || e);
            await new Promise((r) => setTimeout(r, 1000));
        }
    }
};

export const startAlertWorker = async (emit = null) => {
    if (running) return;
    emitFn = emit;
    workerRedis = new Redis(process.env.REDIS_URL || undefined);
    workerRedis.on("error", (e) => console.error("[alertWorker] redis error:", e?.message || e));
    await ensureGroup(workerRedis);
    running = true;
    console.log(`[alertWorker] started (${CONSUMER}), consuming ${USAGE_STREAM}`);
    loop(); // fire; do not await
};

export const stopAlertWorker = async () => {
    running = false;
    if (workerRedis) await workerRedis.quit().catch(() => {});
};
