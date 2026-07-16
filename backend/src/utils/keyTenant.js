import { redis } from "../app.js";
import { ApiKey } from "../models/apikey.model.js";

// Phase 3.7 — resolve an API key hash to its tenant chain, with a SLIDING-TTL
// Redis cache. The alert worker sees the raw apiKey on every threat event but
// needs {projectId, organizationId, environmentId}; a Mongo lookup per event
// would be a hotspot under load. So: cache `akres:<hash>` and refresh its TTL on
// every hit — a busy key stays hot in Redis, a cold key expires. Fail-open to
// Mongo on any Redis error; env-gated `AKRES_TTL_S` (0 disables → pure Mongo).
// Correct with or without the cache; the cache only saves reads under load.
const TTL_S = Number(process.env.AKRES_TTL_S ?? 300);
const cacheKey = (hash) => `akres:${hash}`;

export async function resolveKeyTenant(apiKeyHash) {
    if (!apiKeyHash) return null;

    if (TTL_S > 0) {
        try {
            const cached = await redis.get(cacheKey(apiKeyHash));
            if (cached) {
                await redis.expire(cacheKey(apiKeyHash), TTL_S); // slide the window
                return JSON.parse(cached);
            }
        } catch { /* fall through to Mongo */ }
    }

    const doc = await ApiKey.findOne({ key: apiKeyHash })
        .select("projectId organizationId environmentId")
        .lean();
    if (!doc) return null;

    const tenant = {
        projectId: doc.projectId ? String(doc.projectId) : null,
        organizationId: doc.organizationId ? String(doc.organizationId) : null,
        environmentId: doc.environmentId ? String(doc.environmentId) : null,
    };

    if (TTL_S > 0) {
        try { await redis.set(cacheKey(apiKeyHash), JSON.stringify(tenant), "EX", TTL_S); } catch { /* best effort */ }
    }
    return tenant;
}
