import { rateLimit } from "../utils/rateLimiter.js";

// Coarse per-IP backstop across ALL API traffic. This sits in front of every
// route and catches a single IP that rotates API keys / sessionIds / fingerprints
// to slip past the per-identity limiter. Deliberately generous — it is a flood
// ceiling, not the primary limit. Tune via env.
const GLOBAL_LIMIT = Number(process.env.GLOBAL_RATE_LIMIT) || 300;
const GLOBAL_WINDOW = Number(process.env.GLOBAL_RATE_WINDOW) || 60;

export async function globalRateLimit(req, res, next) {
    const ip = req.ip || "unknown";
    const { allowed, retryAfter } = await rateLimit(`rl:global:${ip}`, GLOBAL_LIMIT, GLOBAL_WINDOW);

    if (!allowed) {
        res.set("Retry-After", String(retryAfter));
        return res.status(429).json({
            success: false,
            statuscode: 429,
            message: "Too many requests from this IP — slow down.",
            data: null,
        });
    }
    return next();
}
