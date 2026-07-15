import { redis } from "../app.js"

// Redis Stream that carries usage/security events off the request hot path.
// The request handler only does a single XADD here and returns; a consumer-group
// worker (workers/usageWorker.js) drains the stream and does the Mongo write +
// socket emit. (Part 1.4 of the roadmap.)
export const USAGE_STREAM = "stream:usage"
export const USAGE_GROUP = "usage-workers"

// Approx cap so a long-running dev instance can't grow the stream unbounded.
const STREAM_MAXLEN = 100000

export const publishUsageEvent = async (event = {}) => {
    try {
        await redis.xadd(
            USAGE_STREAM,
            "MAXLEN", "~", STREAM_MAXLEN,
            "*",
            "apiKey", event.apiKey ?? "",
            "fingerprint", event.fingerprint ?? "",
            "status", event.status ?? "",
            "message", event.message ?? "",
            // Phase 2.1 decision metadata (empty string when the event isn't a
            // scored decision — every field is optional and the worker only
            // persists non-empty ones).
            "riskScore", event.riskScore != null ? String(event.riskScore) : "",
            "action", event.action ?? "",
            "topSignal", event.topSignal ?? "",
            // Phase 2.6 — client IP, consumed by the threat-intel worker to build
            // IP reputation/history. Empty when the caller didn't pass it.
            "ip", event.ip ?? "",
            "ts", Date.now().toString()
        )
    } catch (e) {
        // Never let telemetry publishing break the request.
        console.error("[eventbus] failed to publish usage event:", e?.message || e)
    }
}
