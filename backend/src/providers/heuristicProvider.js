import { DetectionProvider, clamp01, hashString } from "./DetectionProvider.js";

// No-network floor (Phase 2.4). Always available, never throws → guarantees the
// provider chain can always answer (fail-open). classify() is a weak keyword
// scorer (the real prompt-injection heuristics land in 2.5); embed() is a
// deterministic char-3-gram hashing vectorizer (L2-normalized) that yields crude
// but REAL lexical similarity with no model — a genuine offline fallback.
const INJECTION_MARKERS = [
    /ignore\s+(all\s+|the\s+|any\s+)?(previous|above|prior|earlier)\s+(instructions?|prompts?|messages?)/i,
    /disregard\s+(the\s+|all\s+)?(previous|above|system)/i,
    /\b(system\s+prompt|developer\s+message|you\s+are\s+now|act\s+as|jailbreak|DAN\b)/i,
    /<script|onerror\s*=|union\s+select|\$where\b/i,
];

const EMBED_DIM = 256;

export class HeuristicProvider extends DetectionProvider {
    constructor() {
        super("heuristic");
        this.dim = EMBED_DIM;
        this.breaker = null; // never trips
    }

    async classify(text) {
        const s = String(text ?? "");
        let hits = 0;
        for (const re of INJECTION_MARKERS) if (re.test(s)) hits++;
        const confidence = clamp01(hits * 0.3);
        return {
            label: confidence >= 0.5 ? "attack" : "benign",
            confidence,
            rationale: `heuristic: ${hits} marker(s)`,
        };
    }

    async embed(text) {
        const s = String(text ?? "");
        const vec = new Array(this.dim).fill(0);
        for (let i = 0; i + 3 <= s.length; i++) {
            vec[hashString(s.slice(i, i + 3)) % this.dim] += 1;
        }
        let norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0));
        if (norm === 0) norm = 1;
        return vec.map((v) => v / norm);
    }

    async healthy() {
        return true;
    }
}
