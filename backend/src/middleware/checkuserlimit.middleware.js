import { APIResponse } from "../utils/apiresponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { redis } from "../app.js"
import { ApiKey } from "../models/apikey.model.js";
import { hashToken } from "../utils/tokens.js";
import { incSecurityEvent } from "../observability/metrics.js";

const CACHE_TTL_SECONDS = 300;

// Atomic check-and-decrement over a Redis hash {credits, status, id}.
// Returns:  >=0 remaining credits after decrement (allowed)
//           -1  no credits left        -2  cache miss (caller loads from DB)
//           -3  key revoked
const DECREMENT_LUA = `
    if redis.call('EXISTS', KEYS[1]) == 0 then return -2 end
    if redis.call('HGET', KEYS[1], 'status') == 'revoked' then return -3 end
    local c = tonumber(redis.call('HGET', KEYS[1], 'credits'))
    if c == nil then return -2 end
    if c <= 0 then return -1 end
    return redis.call('HINCRBY', KEYS[1], 'credits', -1)
`;

const checkuserlimit = asyncHandler(async (req, res, next) => {
    const rawKey = req.headers['x-api-key'];

    if (!rawKey) {
        return res.status(401).json(new APIResponse(401, {}, "Missing API Key"));
    }

    const keyHash = hashToken(rawKey.trim());
    const cacheKey = `apikey:${keyHash}`;

    let result = await redis.eval(DECREMENT_LUA, 1, cacheKey);

    // Cache miss → hydrate from Mongo (hashed lookup hits the unique index), then retry.
    if (Number(result) === -2) {
        const dbKey = await ApiKey.findOne({ key: keyHash });
        if (!dbKey) {
            return res.status(401).json(new APIResponse(401, {}, "Invalid API key"));
        }
        await redis.hset(cacheKey,
            "credits", dbKey.credits,
            "status", dbKey.status,
            "id", dbKey._id.toString(),
            "projectId", dbKey.projectId?.toString() || "",
            "organizationId", dbKey.organizationId?.toString() || ""
        );
        await redis.expire(cacheKey, CACHE_TTL_SECONDS);
        result = await redis.eval(DECREMENT_LUA, 1, cacheKey);
    }

    result = Number(result);

    if (result === -3) {
        incSecurityEvent("key_revoked");
        return res.status(403).json(new APIResponse(403, {}, "API key revoked"));
    }
    if (result === -1) {
        incSecurityEvent("credits_exhausted");
        return res.status(402).json(new APIResponse(402, {}, "Credits are finished"));
    }

    // Pull the resolved identity in one round-trip. Downstream middleware
    // (rate limiter) needs the SERVER-TRUSTED dimensions — apiKey hash / project /
    // org — so it never has to trust client-supplied sessionId/fingerprint.
    const [id, projectId, organizationId] = await redis.hmget(
        cacheKey, "id", "projectId", "organizationId"
    );

    // Allowed. Mirror the decrement to Mongo off the response path (fire-and-forget);
    // the TTL reload keeps Redis and Mongo reconciled. (Part 1.4 moves this to a worker.)
    if (id) {
        ApiKey.updateOne(
            { _id: id },
            { $inc: { credits: -1 }, $set: { lastUsedAt: new Date() } }
        ).catch((e) => console.error("[checkuserlimit] credit write-back failed:", e?.message));
    }

    req.apiCreditsRemaining = result;
    req.apiKeyId = id || null;
    req.apiKeyHash = keyHash;
    req.projectId = projectId || null;
    req.organizationId = organizationId || null;
    next();
});

export { checkuserlimit }
