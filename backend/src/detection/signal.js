// Detection signal model (Phase 2.1).
//
// Every detector emits a Signal instead of blocking directly. The decision
// middleware fuses all signals on a request into a risk/trust score and picks a
// graduated action. This is what turns the hot path from binary block/allow into
// a tunable, explainable, multi-detector engine (doc 02, Capabilities A & B).

/**
 * @typedef {Object} Signal
 * @property {string} name        stable detector id, e.g. "xss", "sqli"
 * @property {number} confidence  0..1, how sure the detector is
 * @property {*} [evidence]       small, loggable detail (matched pattern, model output)
 * @property {string|null} [owasp] OWASP API/LLM Top-10 tag, e.g. "API#7", "LLM#1"
 * @property {string|null} [mitre] MITRE ATT&CK technique id, e.g. "T1190"
 */

const clamp01 = (n) => {
    const x = Number(n);
    if (Number.isNaN(x)) return 0;
    return x < 0 ? 0 : x > 1 ? 1 : x;
};

/** Normalize an arbitrary object into a well-formed Signal. */
export function makeSignal({ name, confidence, evidence = null, owasp = null, mitre = null }) {
    return {
        name: String(name || "unknown"),
        confidence: clamp01(confidence),
        evidence,
        owasp,
        mitre,
    };
}

/**
 * Attach a signal to the request (lazily initializing req.signals). Detectors
 * call this instead of returning a 403 themselves; the decision middleware
 * decides what to do with the accumulated signals.
 */
export function addSignal(req, signal) {
    if (!Array.isArray(req.signals)) req.signals = [];
    req.signals.push(makeSignal(signal));
    return req.signals;
}
