import { addSignal } from "../detection/signal.js";
import { collectStrings } from "../detection/detectors/collect.js";
import { detectSQLi } from "../detection/detectors/sqli.js";
import { detectNoSQLi } from "../detection/detectors/nosqli.js";
import { detectSSRF } from "../detection/detectors/ssrf.js";
import { detectJWTAbuse } from "../detection/detectors/jwtAbuse.js";
import { detectPromptInjection } from "../detection/detectors/promptInjection.js";
import { scheduleAdvisoryScan } from "../detection/advisory.js";

// Detector registry: each entry runs a pure detector and, on a hit, emits a
// tagged Signal onto req.signals (the decision middleware fuses them). Keeping
// them declarative makes adding a detector a one-line change.
const DETECTORS = [
    { name: "sqli", owasp: "API#8", mitre: "T1190", run: (ctx) => detectSQLi(ctx.strings) },
    { name: "nosqli", owasp: "API#8", mitre: "T1190", run: (ctx) => detectNoSQLi(ctx.body) },
    { name: "ssrf", owasp: "API#7", mitre: "T1190", run: (ctx) => detectSSRF(ctx.strings) },
    { name: "jwt-abuse", owasp: "API#2", mitre: "T1550", run: (ctx) => detectJWTAbuse(ctx.req) },
    // Prompt injection — Layer 1 (heuristic) inline; Layers 2/3 (embedding + LLM)
    // run off the hot path via scheduleAdvisoryScan below.
    { name: "prompt-injection", owasp: "LLM#1", mitre: "AML.T0051", run: (ctx) => detectPromptInjection(ctx.strings) },
];

/**
 * Cheap, synchronous detector stage (Phase 2.3). Collects the scannable inputs
 * once, runs each detector, and emits a Signal per hit. Fail-open per detector:
 * a throwing detector is skipped, never blocks the request.
 */
export const runDetectors = (req, res, next) => {
    const strings = collectStrings(req.body);
    const ctx = { req, body: req.body, strings };
    let promptInjectionInline = 0;
    for (const d of DETECTORS) {
        let result = null;
        try {
            result = d.run(ctx);
        } catch (err) {
            console.error(`[detectors] ${d.name} failed (skipped):`, err?.message || err);
            continue;
        }
        if (result && result.confidence > 0) {
            if (d.name === "prompt-injection") promptInjectionInline = result.confidence;
            addSignal(req, {
                name: d.name,
                confidence: result.confidence,
                evidence: result.evidence,
                owasp: d.owasp,
                mitre: d.mitre,
            });
        }
    }
    // Prompt-injection Layers 2 (embedding similarity) + 3 (LLM classify) run OFF
    // the hot path — provider inference is seconds-scale. This registers a
    // fire-and-forget scan on response finish; it enriches telemetry / catches
    // semantic paraphrases the heuristic missed, and never affects this response.
    scheduleAdvisoryScan(req, res, { strings, promptInjectionInline });
    return next();
};
