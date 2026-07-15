// Provider selection + fallback chain (Phase 2.4).
//
// AI_PROVIDER (env) picks the PRIMARY provider — the user's explicit local
// (ollama) vs cloud (gemini) switch; there is no silent local↔cloud auto-switch.
// A heuristic FLOOR (no-network, never throws) is always appended so the layer
// is fail-open/advisory: on a primary failure/timeout/open-breaker it degrades to
// the floor and NEVER throws. Each provider call is guarded by its own
// CircuitBreaker so a dead provider is skipped fast.
import { HeuristicProvider } from "./heuristicProvider.js";
import { OllamaProvider } from "./ollamaProvider.js";
import { GeminiProvider } from "./geminiProvider.js";
import { MockProvider } from "./mockProvider.js";

export function createProvider(name, env = process.env, deps = {}) {
    switch (String(name || "").toLowerCase()) {
        case "ollama":
            return new OllamaProvider({ http: deps.http, env });
        case "gemini":
            return new GeminiProvider({ http: deps.http, env });
        case "mock":
            return new MockProvider({ fixtures: deps.fixtures });
        case "heuristic":
        default:
            return new HeuristicProvider();
    }
}

// Orchestrates the ordered providers: try each (breaker-gated) until one answers;
// otherwise return the fail value. Never throws.
export class ProviderChain {
    constructor(providers) {
        this.providers = providers.filter(Boolean);
    }

    async classify(text, task) {
        return this._run((p) => p.classify(text, task), { label: "unknown", confidence: 0, provider: null });
    }

    async embed(text) {
        return this._run((p) => p.embed(text), null);
    }

    async _run(call, failValue) {
        for (const p of this.providers) {
            if (p.breaker && !p.breaker.canRequest()) continue; // breaker OPEN → skip
            try {
                const out = await call(p);
                p.breaker?.onSuccess();
                // Tag classify results with the answering provider (arrays pass through).
                return out && !Array.isArray(out) && typeof out === "object" ? { ...out, provider: p.name } : out;
            } catch (err) {
                p.breaker?.onFailure();
                console.warn(`[ai:${p.name}] call failed (trying next): ${err?.message || err}`);
            }
        }
        return failValue;
    }

    get names() {
        return this.providers.map((p) => p.name);
    }
}

/**
 * Build the chain from env: [ primary(AI_PROVIDER) , floor(AI_FALLBACK|heuristic) ].
 * A heuristic floor is always guaranteed last so the chain can always answer.
 */
export function buildProvider(env = process.env, deps = {}) {
    const primaryName = (env.AI_PROVIDER || "ollama").toLowerCase();
    const floorName = (env.AI_FALLBACK || "heuristic").toLowerCase();

    const primary = createProvider(primaryName, env, deps);
    const providers = [primary];

    if (floorName !== primary.name) providers.push(createProvider(floorName, env, deps));
    if (!providers.some((p) => p.name === "heuristic")) providers.push(new HeuristicProvider());

    return new ProviderChain(providers);
}

let singleton;

/** Process-wide singleton chain (built lazily from process.env). */
export function getProvider() {
    if (!singleton) singleton = buildProvider();
    return singleton;
}

/** Test hook: drop the singleton so the next getProvider() rebuilds from env. */
export function _resetProvider() {
    singleton = undefined;
}
