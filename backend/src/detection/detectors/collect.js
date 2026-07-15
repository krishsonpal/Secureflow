// Input collection for the Phase 2.3 detectors. Walks the request body and yields
// the string values worth scanning, bounded in count/length/depth so a huge or
// deeply-nested body can't turn detection into a DoS. Secret-ish fields are
// skipped so they never land in evidence/logs.

const SKIP_KEYS = new Set(["apiKey", "password", "accessToken", "refreshToken"]);

/**
 * Collect scannable strings from an arbitrary body (recursively).
 * @returns {string[]}
 */
export function collectStrings(body, { maxStrings = 40, maxLen = 8192, maxDepth = 6 } = {}) {
    const out = [];
    const walk = (val, depth) => {
        if (out.length >= maxStrings || depth > maxDepth) return;
        if (typeof val === "string") {
            out.push(val.length > maxLen ? val.slice(0, maxLen) : val);
        } else if (Array.isArray(val)) {
            for (const v of val) walk(v, depth + 1);
        } else if (val && typeof val === "object") {
            for (const [k, v] of Object.entries(val)) {
                if (SKIP_KEYS.has(k)) continue;
                walk(v, depth + 1);
            }
        }
    };
    walk(body, 0);
    return out;
}

/** Truncate a matched fragment for safe, bounded evidence. */
export function evidence(str, max = 100) {
    if (typeof str !== "string") return String(str).slice(0, max);
    return str.length > max ? str.slice(0, max) + "…" : str;
}
