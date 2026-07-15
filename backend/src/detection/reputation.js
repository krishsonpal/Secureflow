// Threat reputation store (Phase 2.6).
//
// Two sources feed one confidence:
//   1. External blocklists (Tor exit list, FireHOL, abuse.ch) ingested by the
//      feed worker — the trustworthy, curated dimension.
//   2. Locally-observed attacks — IPs/fingerprints we've caught attacking before,
//      counted by the threat-intel worker off the hot path.
//
// The decision path calls lookupReputation() and, on a hit, emits a `reputation`
// signal (weight 60 → challenge on its own; blocks when corroborated by another
// detector — deliberately low-FP, since e.g. Tor users aren't all attackers).
//
// Everything FAILS OPEN: any Redis error returns null / no-ops. Reputation also
// DECAYS — every key is written with a TTL, nothing is permanent.

import { redis } from "../app.js";
import ipaddr from "ipaddr.js";

// ── Per-source confidence weights ────────────────────────────────────────────
// Feeds are NOT equally trustworthy (a Tor exit ≠ a known C2 IP), so confidence
// is a tunable, env-overridable map — operators tune without code changes.
export const SOURCE_WEIGHTS = {
    tor: Number(process.env.REP_WEIGHT_TOR ?? 0.5),
    firehol: Number(process.env.REP_WEIGHT_FIREHOL ?? 0.7),
    abusech: Number(process.env.REP_WEIGHT_ABUSECH ?? 0.95),
};

// TTLs (seconds). Local reputation decays over ~a day; feed entries are refreshed
// by the ingest worker and given a TTL longer than its interval so a stale feed
// self-expires rather than lingering forever.
const REP_TTL_S = Number(process.env.REPUTATION_TTL_S ?? 86400); // 24h
const LOCAL_CAP = Number(process.env.REP_LOCAL_CAP ?? 0.9);

const IP_KEY = (ip) => `rep:ip:${ip}`;
const FP_KEY = (fp) => `rep:fp:${fp}`;

// Atomic INCR + EXPIRE-on-first (same idiom as the rate limiter) so a counter
// always carries a decay TTL without a second round-trip.
const INCR_EXPIRE_LUA = `
    local current = redis.call("INCR", KEYS[1])
    if current == 1 then
        redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
    end
    return current
`;

// ── FeedStore ─────────────────────────────────────────────────────────────────
// Public surface is a single query: FeedStore.lookup(ip) → { source } | null.
// Storage strategy is private and swappable (today: Redis exact-IP set + an
// in-memory linear CIDR scan; later a radix tree / Bloom filter) WITHOUT touching
// any caller. Ingestion writes via setExactBatch / setCidrs.

const FEED_IP_PREFIX = "rep:feed:"; // exact IP → source tag
const FEED_CIDR_KEY = "rep:feed:cidr:firehol"; // JSON array of CIDR strings
// How often the lookup side reloads + reparses the CIDR list from Redis into
// memory. Parse-once-at-refresh: per-request lookups reuse the parsed objects.
const CIDR_RELOAD_MS = Number(process.env.FEED_CIDR_RELOAD_MS ?? 300000); // 5m

let cidrCache = { ranges: [], loadedAt: 0 };

const safeParseIp = (ip) => {
    try {
        return ipaddr.parse(ip);
    } catch {
        return null;
    }
};

// Reload the FireHOL prefix list from Redis and parse each CIDR ONCE with
// ipaddr.js (which owns the IPv4/IPv6/mask/malformed edge cases). Memoized for
// CIDR_RELOAD_MS. On error the previous cache is kept (fail-open).
const ensureCidrs = async () => {
    const now = Date.now();
    if (now - cidrCache.loadedAt < CIDR_RELOAD_MS && cidrCache.loadedAt !== 0) {
        return cidrCache.ranges;
    }
    try {
        const raw = await redis.get(FEED_CIDR_KEY);
        const list = raw ? JSON.parse(raw) : [];
        const ranges = [];
        for (const cidr of list) {
            try {
                ranges.push(ipaddr.parseCIDR(cidr)); // [addr, prefixLen]
            } catch {
                // malformed CIDR — skip, don't let one bad line poison the set
            }
        }
        cidrCache = { ranges, loadedAt: now };
    } catch (e) {
        // Keep whatever we had; nudge loadedAt so we don't hammer Redis on a
        // persistent error, but still retry after the interval.
        cidrCache = { ranges: cidrCache.ranges, loadedAt: now };
    }
    return cidrCache.ranges;
};

export const FeedStore = {
    /** @returns {Promise<{source:string}|null>} */
    async lookup(ip) {
        if (!ip) return null;
        try {
            const source = await redis.get(FEED_IP_PREFIX + ip);
            if (source) return { source };

            const parsed = safeParseIp(ip);
            if (!parsed) return null;
            const ranges = await ensureCidrs();
            for (const cidr of ranges) {
                try {
                    if (parsed.match(cidr)) return { source: "firehol" };
                } catch {
                    // kind mismatch (v4 vs v6) — skip this range
                }
            }
            return null;
        } catch (e) {
            return null; // fail-open
        }
    },

    /** Ingest: write a batch of exact IPs for a source with a TTL. */
    async setExactBatch(ips, source, ttlSeconds) {
        if (!Array.isArray(ips) || ips.length === 0) return 0;
        try {
            const pipe = redis.pipeline();
            for (const ip of ips) pipe.set(FEED_IP_PREFIX + ip, source, "EX", ttlSeconds);
            await pipe.exec();
            return ips.length;
        } catch (e) {
            console.error("[reputation] setExactBatch failed:", e?.message || e);
            return 0;
        }
    },

    /** Ingest: replace the FireHOL CIDR list with a TTL. */
    async setCidrs(cidrList, ttlSeconds) {
        try {
            await redis.set(FEED_CIDR_KEY, JSON.stringify(cidrList || []), "EX", ttlSeconds);
            cidrCache = { ranges: [], loadedAt: 0 }; // force a reload next lookup
            return Array.isArray(cidrList) ? cidrList.length : 0;
        } catch (e) {
            console.error("[reputation] setCidrs failed:", e?.message || e);
            return 0;
        }
    },

    /** Test hook: drop the in-memory CIDR cache. */
    _resetCache() {
        cidrCache = { ranges: [], loadedAt: 0 };
    },
};

// ── Local reputation ──────────────────────────────────────────────────────────

/**
 * Record that this IP/fingerprint was caught attacking. Increments decaying
 * counters. Called by the threat-intel worker off the hot path. No-op / fail-open
 * on error — telemetry must never break anything.
 */
export const recordAttack = async ({ ip, fingerprint } = {}) => {
    try {
        const ops = [];
        if (ip) ops.push(redis.eval(INCR_EXPIRE_LUA, 1, IP_KEY(ip), REP_TTL_S));
        if (fingerprint) ops.push(redis.eval(INCR_EXPIRE_LUA, 1, FP_KEY(fingerprint), REP_TTL_S));
        if (ops.length) await Promise.all(ops);
    } catch (e) {
        console.error("[reputation] recordAttack failed:", e?.message || e);
    }
};

// Map a prior-attack count → confidence. A single prior hit is soft (0.45);
// repeat offenders escalate toward the cap. reputation weight 60 means ~0.67
// confidence (≈3 prior hits) is needed before this alone reaches `challenge`.
const localConfidence = (count) => Math.min(LOCAL_CAP, 0.3 + 0.15 * count);

/**
 * Fuse feed hits + local counts into a single reputation confidence for a
 * request. Takes the MAX across sources. Returns null (no signal) when nothing is
 * known. Fail-open → null on any error.
 *
 * @param {{ip?:string, fingerprint?:string}} params
 * @returns {Promise<{confidence:number, source:string, evidence:object}|null>}
 */
export const lookupReputation = async ({ ip, fingerprint } = {}) => {
    try {
        let best = 0;
        let source = null;
        const evidence = {};

        if (ip) {
            const feed = await FeedStore.lookup(ip);
            if (feed) {
                const w = SOURCE_WEIGHTS[feed.source] ?? 0.5;
                evidence.feed = feed.source;
                if (w > best) {
                    best = w;
                    source = feed.source;
                }
            }
        }

        const [ipCount, fpCount] = await Promise.all([
            ip ? redis.get(IP_KEY(ip)) : null,
            fingerprint ? redis.get(FP_KEY(fingerprint)) : null,
        ]);
        const localCount = Math.max(Number(ipCount) || 0, Number(fpCount) || 0);
        if (localCount > 0) {
            evidence.localCount = localCount;
            const lc = localConfidence(localCount);
            if (lc > best) {
                best = lc;
                source = source || "local";
            }
        }

        if (best <= 0) return null;
        return { confidence: best, source, evidence };
    } catch (e) {
        return null; // fail-open
    }
};
