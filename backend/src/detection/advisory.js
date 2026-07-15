// Prompt-injection advisory scan — Layers 2 (embedding similarity) + 3 (LLM
// classify), Phase 2.5. Runs OFF the hot path (fire-and-forget on response
// finish) because provider inference is seconds-scale — it NEVER affects the
// current response. Its job is to catch semantic/paraphrased injections the
// inline heuristic (Layer 1) missed, and surface them (metric + structured log).
// It does NOT write a threat-status usage row (that would inflate "threatsBlocked"
// for something that wasn't enforced); surfacing advisories in the dashboard /
// alerting is Phase 2.9.
import { getEmbedProvider, getProvider } from "../providers/index.js";
import { maxTemplateSimilarity } from "./promptInjectionBank.js";
import { incSecurityEvent } from "../observability/metrics.js";

const bool = (v, d) => (v === undefined ? d : String(v).toLowerCase() === "true");
const PI_ADVISORY = () => bool(process.env.PI_ADVISORY, true);
const PI_LLM_ADVISORY = () => bool(process.env.PI_LLM_ADVISORY, false);
const PI_SIM_THRESHOLD = () => Number(process.env.PI_SIM_THRESHOLD) || 0.6;

/**
 * Pure(ish) advisory logic — providers injected so it is fully unit-testable
 * mock-only. Layer 2 (embedding similarity) is best-effort (skipped if the
 * embedder is unavailable, e.g. Ollama down); Layer 3 (LLM classify) is opt-in.
 * @returns {Promise<{flagged:boolean, score:number, matched:string|null, classify:object|null}>}
 */
export async function advisoryPromptInjection({
    text,
    embedProvider,
    classifyProvider = null,
    threshold = PI_SIM_THRESHOLD(),
    useLLM = PI_LLM_ADVISORY(),
} = {}) {
    const result = { flagged: false, score: 0, matched: null, classify: null };
    if (!text || !String(text).trim()) return result;

    // Layer 2 — embedding similarity to the injection-template bank.
    if (embedProvider) {
        try {
            const { score, matched } = await maxTemplateSimilarity(text, embedProvider);
            result.score = score;
            result.matched = matched;
        } catch {
            /* embedder unavailable → skip Layer 2 (advisory, best-effort) */
        }
    }

    // Layer 3 — LLM classify (opt-in; seconds-scale; treat payload as untrusted data).
    if (useLLM && classifyProvider) {
        try {
            result.classify = await classifyProvider.classify(text, "prompt-injection");
        } catch {
            /* classifier unavailable → skip Layer 3 */
        }
    }

    const semantic = result.score >= threshold;
    const llm = result.classify && result.classify.label === "attack" && result.classify.confidence >= 0.6;
    result.flagged = Boolean(semantic || llm);
    return result;
}

/**
 * Register the advisory scan to run when the response finishes (off the hot path).
 * Skips when the inline heuristic already strongly flagged PI (nothing to add) or
 * when advisory is disabled.
 */
export function scheduleAdvisoryScan(req, res, { strings, promptInjectionInline = 0 } = {}) {
    if (!PI_ADVISORY()) return;
    const text = (strings || []).join("\n").trim();
    if (!text) return;
    if (promptInjectionInline >= 0.9) return; // inline Layer 1 already caught it

    res.on("finish", () => {
        Promise.resolve()
            .then(async () => {
                const r = await advisoryPromptInjection({
                    text,
                    embedProvider: getEmbedProvider(),
                    classifyProvider: getProvider(),
                });
                if (r.flagged) {
                    incSecurityEvent("prompt_injection_advisory");
                    console.warn(
                        `[advisory] prompt-injection semantic match (sim=${r.score.toFixed(2)}` +
                        `${r.classify ? `, llm=${r.classify.label}@${r.classify.confidence}` : ""})`
                    );
                }
            })
            .catch((e) => console.warn("[advisory] scan failed:", e?.message || e));
    });
}
