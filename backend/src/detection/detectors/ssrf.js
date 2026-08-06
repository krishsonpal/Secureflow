// SSRF detector (Phase 2.3). Scans string values for URLs that target cloud
// metadata endpoints, internal/private hosts, or dangerous schemes — the shapes
// used to pivot from a public API into the internal network / cloud creds.
// OWASP API#7.
import { evidence } from "./collect.js";

// Cloud instance-metadata endpoints (AWS/GCP/Azure/ECS/Alibaba).
const METADATA = /(169\.254\.169\.254|169\.254\.170\.2|100\.100\.100\.200|metadata\.google\.internal|metadata\.azure\.com)/i;

// Non-web schemes commonly abused for SSRF pivots / file reads.
const DANGEROUS_SCHEME = /\b(file|gopher|dict|ldap|ftp|tftp|jar|netdoc):\/\//i;

// Private / loopback / link-local host reached via http(s) (require a scheme to
// cut false positives on bare IP-looking strings).
const INTERNAL_URL = /\bhttps?:\/\/(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|\[::1\]|localhost)\b/i;

/**
 * @param {string[]} strings
 * @returns {{confidence:number, evidence:any}|null}
 */
export function detectSSRF(strings = []) {
    let confidence = 0;
    const hits = [];
    let sample = "";

    for (const s of strings) {
        if (typeof s !== "string" || !s) continue;
        if (METADATA.test(s)) {
            confidence = Math.max(confidence, 0.95);
            hits.push("cloud-metadata");
            if (!sample) sample = s;
        }
        if (DANGEROUS_SCHEME.test(s)) {
            confidence = Math.max(confidence, 0.85);
            hits.push("dangerous-scheme");
            if (!sample) sample = s;
        }
        if (INTERNAL_URL.test(s)) {
            confidence = Math.max(confidence, 0.8);
            hits.push("internal-host");
            if (!sample) sample = s;
        }
    }

    if (confidence <= 0) return null;
    return { confidence, evidence: { patterns: [...new Set(hits)], sample: evidence(sample) } };
}
