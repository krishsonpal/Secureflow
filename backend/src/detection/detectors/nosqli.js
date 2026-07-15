// NoSQL operator-injection detector (Phase 2.3). Walks the raw body for injected
// Mongo query operators ($ne, $gt, $where, $regex, …) — the classic
// `{"username": {"$ne": null}}` auth bypass — plus `$where`/`function()` in
// string values. OWASP API#8.
import { evidence } from "./collect.js";

const DANGEROUS_OPS = new Set([
    "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin",
    "$where", "$regex", "$exists", "$or", "$and", "$not", "$expr", "$function",
]);

const SKIP_KEYS = new Set(["apiKey", "password", "accessToken", "refreshToken"]);

/**
 * @param {object} body
 * @returns {{confidence:number, evidence:any}|null}
 */
export function detectNoSQLi(body) {
    const hits = [];
    let confidence = 0;

    const walk = (val, depth) => {
        if (depth > 6 || val == null) return;
        if (typeof val === "string") {
            if (/\$where\b|function\s*\(\s*\)\s*\{|\bthis\.\w+/i.test(val)) {
                confidence = Math.max(confidence, 0.7);
                hits.push({ op: "$where-string", sample: evidence(val) });
            }
            return;
        }
        if (Array.isArray(val)) {
            for (const v of val) walk(v, depth + 1);
            return;
        }
        if (typeof val === "object") {
            for (const [k, v] of Object.entries(val)) {
                if (SKIP_KEYS.has(k)) continue;
                if (DANGEROUS_OPS.has(k)) {
                    confidence = Math.max(confidence, 0.9);
                    hits.push({ op: k });
                }
                walk(v, depth + 1);
            }
        }
    };

    try {
        walk(body, 0);
    } catch {
        return null;
    }

    if (confidence <= 0) return null;
    return { confidence, evidence: { operators: hits.slice(0, 8) } };
}
