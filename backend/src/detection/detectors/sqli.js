// SQL injection detector (Phase 2.3). Pure heuristic (no libinjection native
// binding — keeps the "no new runtime dep" scope and Windows-friendly). Two
// tiers, tuned for LOW false positives:
//   STRONG (0.9): precise structural attacks (tautology w/ backref, UNION SELECT,
//                 stacked queries, time-based, select…from) — block on their own.
//   MID    (0.5): an injection-specific keyword TOGETHER with a probe marker
//                 (SQL comment or quote) — a likely probe, but only "challenge".
// A lone SQL keyword in prose ("select your plan", "update profile") does NOT
// fire — that common case is where naive detectors generate false positives.
// OWASP API#8.
import { evidence } from "./collect.js";

const STRONG = [
    { re: /\b(or|and)\s+(\d+)\s*=\s*\2\b/i, why: "numeric tautology" },            // OR 1=1
    { re: /['"]\s*(or|and)\s+['"]?\w+['"]?\s*=\s*['"]?\w+/i, why: "quoted tautology" }, // ' OR 'a'='a
    { re: /\bunion\b[\s\S]{0,30}\bselect\b/i, why: "union select" },
    { re: /;\s*(drop|delete|insert|update|alter|create|truncate)\b/i, why: "stacked query" },
    { re: /\b(sleep|benchmark|pg_sleep|waitfor\s+delay)\s*\(/i, why: "time-based blind" },
    { re: /\b(select|insert|update|delete)\b[\s\S]{0,40}\bfrom\b/i, why: "select…from" },
];

// Injection-specific keywords (deliberately excludes the ultra-common or/and/
// where/from, which the STRONG structural patterns already cover in-context).
const MID_KEYWORD = /\b(union|select|insert|update|delete|drop|truncate)\b/i;
const COMMENT = /(--|#)\s|\/\*[\s\S]*?\*\//;
const QUOTE = /['"`]/;

/**
 * @param {string[]} strings
 * @returns {{confidence:number, evidence:any}|null}
 */
export function detectSQLi(strings = []) {
    let confidence = 0;
    const hits = [];
    let sample = "";

    for (const s of strings) {
        if (typeof s !== "string" || !s) continue;

        let strong = false;
        for (const { re, why } of STRONG) {
            if (re.test(s)) {
                strong = true;
                if (!hits.includes(why)) hits.push(why);
            }
        }
        if (strong) {
            confidence = Math.max(confidence, 0.9);
            if (!sample) sample = s;
            continue;
        }

        // MID: an injection keyword paired with a probe marker (comment or quote).
        if (MID_KEYWORD.test(s) && (COMMENT.test(s) || QUOTE.test(s))) {
            confidence = Math.max(confidence, 0.5);
            if (!hits.includes("keyword+marker")) hits.push("keyword+marker");
            if (!sample) sample = s;
        }
    }

    if (confidence <= 0) return null;
    return { confidence, evidence: { patterns: hits, sample: evidence(sample) } };
}
