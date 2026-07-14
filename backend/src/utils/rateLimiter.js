import { redis } from "../app.js";

/**
 * Reusable fixed-window rate limiter backed by Redis.
 *
 * Fixed window (INCR + EXPIRE-on-first) is atomic in a single Lua round-trip and
 * matches the idiom already used in the hot path. It keys off an arbitrary
 * caller-supplied string so the SAME util powers the global per-IP backstop and
 * the per-(apiKey+IP) validation limiter — the caller decides the dimension.
 *
 * The key must be server-trusted: never build it from client-supplied values
 * (sessionId/fingerprint) alone, or the limit is trivially bypassed by rotating
 * them. Compose it from resolved identity (apiKey hash / projectId) + req.ip.
 */
const FIXED_WINDOW_LUA = `
    local current = redis.call("INCR", KEYS[1])
    if current == 1 then
        redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
    end
    return current
`;

/**
 * @param {string} key            Server-trusted Redis key for this limit bucket.
 * @param {number} limit          Max requests allowed within the window.
 * @param {number} windowSeconds  Window length in seconds.
 * @returns {Promise<{allowed:boolean,count:number,limit:number,remaining:number,retryAfter:number,failedOpen?:boolean}>}
 *
 * Fails OPEN on any Redis error — availability over strict enforcement, matching
 * the rest of the hot path (XSS check, credit check). A limiter that hard-fails
 * closed would turn a Redis blip into a full outage.
 */
export async function rateLimit(key, limit, windowSeconds) {
    try {
        const count = Number(
            await redis.eval(FIXED_WINDOW_LUA, 1, key, windowSeconds)
        );

        const allowed = count <= limit;

        // Only pay the PTTL round-trip when we actually need Retry-After (rejection).
        let retryAfter = windowSeconds;
        if (!allowed) {
            const ttlMs = Number(await redis.pttl(key));
            if (ttlMs > 0) retryAfter = Math.ceil(ttlMs / 1000);
        }

        return {
            allowed,
            count,
            limit,
            remaining: Math.max(0, limit - count),
            retryAfter,
        };
    } catch (err) {
        console.error("[rateLimiter] Redis error, failing open:", err?.message || err);
        return { allowed: true, count: 0, limit, remaining: limit, retryAfter: 0, failedOpen: true };
    }
}
