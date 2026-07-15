import { addSignal } from "../detection/signal.js";
import { collectStrings } from "../detection/detectors/collect.js";
import { detectSQLi } from "../detection/detectors/sqli.js";
import { detectNoSQLi } from "../detection/detectors/nosqli.js";
import { detectSSRF } from "../detection/detectors/ssrf.js";
import { detectJWTAbuse } from "../detection/detectors/jwtAbuse.js";

// Detector registry: each entry runs a pure detector and, on a hit, emits a
// tagged Signal onto req.signals (the decision middleware fuses them). Keeping
// them declarative makes adding a detector a one-line change.
const DETECTORS = [
    { name: "sqli", owasp: "API#8", mitre: "T1190", run: (ctx) => detectSQLi(ctx.strings) },
    { name: "nosqli", owasp: "API#8", mitre: "T1190", run: (ctx) => detectNoSQLi(ctx.body) },
    { name: "ssrf", owasp: "API#7", mitre: "T1190", run: (ctx) => detectSSRF(ctx.strings) },
    { name: "jwt-abuse", owasp: "API#2", mitre: "T1550", run: (ctx) => detectJWTAbuse(ctx.req) },
];

/**
 * Cheap, synchronous detector stage (Phase 2.3). Collects the scannable inputs
 * once, runs each detector, and emits a Signal per hit. Fail-open per detector:
 * a throwing detector is skipped, never blocks the request.
 */
export const runDetectors = (req, res, next) => {
    const ctx = { req, body: req.body, strings: collectStrings(req.body) };
    for (const d of DETECTORS) {
        let result = null;
        try {
            result = d.run(ctx);
        } catch (err) {
            console.error(`[detectors] ${d.name} failed (skipped):`, err?.message || err);
            continue;
        }
        if (result && result.confidence > 0) {
            addSignal(req, {
                name: d.name,
                confidence: result.confidence,
                evidence: result.evidence,
                owasp: d.owasp,
                mitre: d.mitre,
            });
        }
    }
    return next();
};
