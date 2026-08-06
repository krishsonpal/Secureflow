import { DetectionProvider, hashString, normalizeClassification } from "./DetectionProvider.js";

// Deterministic mock (Phase 2.4). Selected by AI_PROVIDER=mock (or in tests). No
// network — lets the whole abstraction + its consumers (2.5) be exercised in the
// sandbox where a real LLM is unreachable. classify() prefers an injected fixture
// map, else a deterministic rule; embed() is a stable seeded pseudo-vector (same
// text → same vector) so cache/interface/similarity mechanics are testable.
const EMBED_DIM = 256;

export class MockProvider extends DetectionProvider {
    constructor({ fixtures = {} } = {}) {
        super("mock");
        this.fixtures = fixtures;
        this.dim = EMBED_DIM;
        this.breaker = null;
    }

    async classify(text) {
        const key = String(text ?? "");
        if (Object.prototype.hasOwnProperty.call(this.fixtures, key)) {
            return normalizeClassification(this.fixtures[key], "benign");
        }
        const attack = /ignore\s+previous|system\s+prompt|<script|union\s+select|jailbreak/i.test(key);
        return {
            label: attack ? "attack" : "benign",
            confidence: attack ? 0.9 : 0.05,
            rationale: "mock",
        };
    }

    async embed(text) {
        let seed = hashString(text);
        const vec = new Array(this.dim);
        for (let i = 0; i < this.dim; i++) {
            // LCG step → deterministic pseudo-random component in [-1, 1].
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            vec[i] = (seed / 0xffffffff) * 2 - 1;
        }
        let norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
        return vec.map((v) => v / norm);
    }

    async healthy() {
        return true;
    }
}
