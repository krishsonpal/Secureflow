// JWT abuse detector (Phase 2.3). Decodes presented tokens WITHOUT verifying and
// flags the cheap, high-impact tampering shapes: `alg=none` (signature bypass)
// and `kid` injection (path traversal / SQLi in the key id). Stateless; replay /
// impossible-travel is handled by the stateful signal in 2.6. OWASP API#2.
import { evidence } from "./collect.js";

const b64urlDecode = (seg) => {
    try {
        const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
        return Buffer.from(b64, "base64").toString("utf8");
    } catch {
        return null;
    }
};

const looksLikeJwt = (t) => typeof t === "string" && /^[\w-]+\.[\w-]+\.[\w-]*$/.test(t) && t.length < 8192;

// Suspicious kid values: path traversal, SQL/command metacharacters, newlines.
const KID_INJECTION = /(\.\.\/|\.\.\\|\/etc\/|['";]|\n|\r|\bunion\b|\bselect\b|\|\||&&)/i;

/**
 * @param {import('express').Request} req
 * @returns {{confidence:number, evidence:any}|null}
 */
export function detectJWTAbuse(req) {
    const candidates = [];
    const auth = req.headers?.authorization || req.headers?.Authorization;
    if (typeof auth === "string" && /^Bearer\s+/i.test(auth)) candidates.push(auth.replace(/^Bearer\s+/i, "").trim());
    for (const f of ["token", "jwt", "idToken", "id_token"]) {
        const v = req.body?.[f];
        if (typeof v === "string") candidates.push(v);
    }

    let confidence = 0;
    const hits = [];

    for (const tok of candidates) {
        if (!looksLikeJwt(tok)) continue;
        const header = b64urlDecode(tok.split(".")[0]);
        if (!header) continue;
        let parsed;
        try {
            parsed = JSON.parse(header);
        } catch {
            continue;
        }
        const alg = String(parsed?.alg ?? "").toLowerCase();
        if (alg === "none") {
            confidence = Math.max(confidence, 0.95);
            hits.push({ issue: "alg=none" });
        }
        if (typeof parsed?.kid === "string" && KID_INJECTION.test(parsed.kid)) {
            confidence = Math.max(confidence, 0.8);
            hits.push({ issue: "kid-injection", kid: evidence(parsed.kid, 60) });
        }
    }

    if (confidence <= 0) return null;
    return { confidence, evidence: { findings: hits } };
}
