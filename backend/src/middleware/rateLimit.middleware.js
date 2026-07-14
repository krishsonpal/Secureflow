import { APIResponse } from "../utils/apiresponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { redis } from "../app.js";
import { rateLimit } from "../utils/rateLimiter.js";
import { loadSecurityRule } from "../utils/securityRule.js";
import { logUsageAsync } from "../utils/logusage.js";

/**
 * Per-identity rate limiter for the SDK hot path. MUST run AFTER checkuserlimit,
 * which resolves the server-trusted identity onto req (apiKeyHash / projectId).
 *
 * The limit bucket is keyed on `apiKey hash + client IP` — dimensions the client
 * cannot forge. This is the fix for the old `rate:session:<sessionId>` limiter,
 * where the client supplied the whole key and rotating sessionId reset the count.
 *
 * Per-project limit/window/ban/whitelist come from the SecurityRule (cached,
 * fail-open to defaults). Whitelisted IPs bypass entirely. Fails OPEN on Redis
 * errors (rateLimit() handles that) for availability.
 */
export const enforceRateLimit = asyncHandler(async (req, res, next) => {
    const ip = req.ip || "unknown";
    const apiKeyHash = req.apiKeyHash;
    const projectId = req.projectId;

    // Identity should always be present (checkuserlimit ran first). If somehow
    // absent, fall back to IP-only so we still apply *some* limit.
    const identity = apiKeyHash || "anon";

    const rule = await loadSecurityRule(projectId);

    // 1. Whitelist bypass — trusted IPs are never limited.
    if (Array.isArray(rule.whitelistips) && rule.whitelistips.includes(ip)) {
        return next();
    }

    // 2. Active ban? A prior breach can park this identity+IP in a temporary ban.
    const banKey = `rl:ban:${identity}:${ip}`;
    try {
        if (await redis.exists(banKey)) {
            const ttl = Number(await redis.ttl(banKey));
            await logUsageAsync(req.body?.apiKey, req.body?.fingerprint, "rate-limited", "Temporarily banned for exceeding rate limit.");
            return res.status(429).json(
                new APIResponse(429, { retryAfter: ttl > 0 ? ttl : rule.banDuration, banned: true }, "Too many requests — temporarily banned")
            );
        }
    } catch (err) {
        // Ban lookup failure is non-fatal — fall through to the counter.
        console.error("[rateLimit] ban check failed:", err?.message || err);
    }

    // 3. Fixed-window counter on the server-trusted identity + IP.
    const rlKey = `rl:req:${identity}:${ip}`;
    const { allowed, retryAfter } = await rateLimit(rlKey, rule.rateLimit, rule.rateWindow);

    if (!allowed) {
        // Optionally park the offender in a temporary ban so a sustained flood
        // doesn't keep re-hitting the window every second.
        if (rule.banDuration > 0) {
            redis.set(banKey, "1", "EX", rule.banDuration)
                .catch((e) => console.error("[rateLimit] set ban failed:", e?.message));
        }

        await logUsageAsync(req.body?.apiKey, req.body?.fingerprint, "rate-limited");
        return res.status(429).json(
            new APIResponse(429, { retryAfter }, "Rate limit exceeded")
        );
    }

    return next();
});
