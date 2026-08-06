import axios from "axios";
import { redis } from "../app.js";
import { hashToken } from "../utils/tokens.js";
import { CircuitBreaker } from "../utils/circuitBreaker.js";
import { addSignal } from "../detection/signal.js";

const ML_TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS) || 1500;
const VERDICT_TTL_SECONDS = Number(process.env.XSS_CACHE_TTL) || 300;

// Shared secret for the ML service. When set, sent as x-api-key so the ML
// service (which enforces it when its own ML_API_KEY is configured) accepts the
// call. Left unset for local dev where the ML service runs open.
const ML_API_KEY = process.env.MICROSERVICE_API_KEY || "";

// Cap the payload we hand to the ML service — mirrors the service's own input
// cap and avoids shipping a giant body over the wire. Oversized input skips the
// ML call and is treated as unscannable (fail policy applies).
const ML_MAX_CONTENT_CHARS = Number(process.env.ML_MAX_CONTENT_CHARS) || 100000;

// Per-check policy. The XSS check is a security add-on, not a hard dependency,
// so it fails OPEN by default (set XSS_FAIL_OPEN=false to fail closed).
const XSS_FAIL_OPEN = process.env.XSS_FAIL_OPEN !== "false";

// Breaker around the ML HTTP dependency: after repeated failures we stop calling
// it for a cooldown and degrade instantly instead of eating the timeout each time.
const mlBreaker = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 30000, name: "ml-xss" });

// Phase 2.1: instead of blocking directly, the XSS check now EMITS a signal onto
// req.signals and always continues; the decision middleware fuses it with any
// other detector signals and picks the graduated action. A positive ML verdict
// is authoritative, so the signal carries confidence 1.0 (weight 100 in the
// scorer → risk 100 → block), reproducing the old binary block behavior while
// letting future detectors corroborate.
const emitXSS = (req, evidence) => {
    addSignal(req, {
        name: "xss",
        confidence: 1,
        evidence,
        owasp: "API#3", // Broken Object Property Level Authorization / injection-adjacent
        mitre: "T1059", // Command and Scripting Interpreter
    });
};

// Apply the fail policy when the ML verdict is unavailable. Fail-open → emit no
// signal and continue (unscannable ≠ malicious). Fail-closed → 503.
const degrade = (res, next, reason) => {
    if (XSS_FAIL_OPEN) {
        console.warn(`[checkXSS] ${reason} — failing open (no signal)`);
        return next();
    }
    return res.status(503).json({ message: "XSS check unavailable" });
};

export const checkXSS = async (req, res, next) => {
    const input = req.body.requestdata;

    // Nothing to scan → no signal.
    if (input === undefined || input === null || input === "") {
        return next();
    }

    // Oversized payloads: don't ship them to the ML service. Apply the fail
    // policy (open by default) rather than treating large bodies as malicious.
    if (typeof input === "string" && input.length > ML_MAX_CONTENT_CHARS) {
        return degrade(res, next, `payload exceeds ${ML_MAX_CONTENT_CHARS} chars`);
    }

    const cacheKey = `xss:v:${hashToken(input)}`;

    // 1. Verdict cache — identical payloads skip the ML round trip entirely.
    try {
        const cached = await redis.get(cacheKey);
        if (cached !== null) {
            if (Number(cached) === 1) emitXSS(req, { cached: true });
            return next();
        }
    } catch {
        /* cache read failure shouldn't block the request */
    }

    // 2. Circuit breaker — if the ML service is known-bad, skip the call.
    if (!mlBreaker.canRequest()) {
        return degrade(res, next, "ML circuit open");
    }

    // 3. Call the ML service.
    try {
        const response = await axios.post(
            process.env.MICROSERVICE_URI,
            { content: input },
            {
                timeout: ML_TIMEOUT_MS,
                headers: ML_API_KEY ? { "x-api-key": ML_API_KEY } : undefined,
            }
        );
        mlBreaker.onSuccess();

        const prediction = response.data?.prediction === 1 ? 1 : 0;
        redis.set(cacheKey, prediction, "EX", VERDICT_TTL_SECONDS).catch(() => {});

        if (prediction === 1) {
            emitXSS(req, response.data);
        }
        return next();
    } catch (error) {
        mlBreaker.onFailure();
        return degrade(res, next, `ML unavailable (${error?.code || error?.message || "error"})`);
    }
};
