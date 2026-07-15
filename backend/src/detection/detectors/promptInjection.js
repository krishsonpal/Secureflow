// Prompt-injection detector — Layer 1 (heuristic bank), Phase 2.5. Synchronous,
// sub-ms, runs inline in the detector stack and emits a `prompt-injection` signal.
// Layers 2 (embedding similarity) and 3 (LLM classify) run OFF the hot path (see
// detection/advisory.js) because provider inference is seconds-scale.
//
// Covers DIRECT injection (payload is the request content) and INDIRECT injection
// (payload arrives inside a nested field) — the caller passes the recursively
// collected strings. OWASP LLM#1, MITRE ATLAS AML.T0051.
//
// Tuning (scorer weight for `prompt-injection` = 70; block threshold = 70):
//   STRONG (1.0) → risk 70 → BLOCK   — canonical, unambiguous injection.
//   MID    (0.6) → risk 42 → CHALLENGE — suspicious but plausibly benign prose.
// Weights/thresholds are per-tenant tunable (SecurityRule.scoring), so a tenant
// can make prompt-injection challenge-only by lowering its weight.
import { evidence } from "./collect.js";

const STRONG = [
    { re: /\bignore\s+(all\s+|any\s+|the\s+)?(previous|above|prior|earlier|preceding)\s+(instructions?|prompts?|messages?|context|rules?)/i, why: "instruction-override" },
    { re: /\bdisregard\s+(all\s+|the\s+|any\s+)?(previous|above|prior|earlier|system)\b/i, why: "disregard-previous" },
    { re: /\bforget\s+(everything|all|your\s+(instructions|training|rules|prompt))\b/i, why: "forget-instructions" },
    { re: /\b(reveal|print|show|repeat|output|tell\s+me|display)\s+(me\s+)?(your\s+|the\s+|your\s+initial\s+)?(system\s+prompt|initial\s+instructions|your\s+instructions|your\s+rules|the\s+prompt\s+above)/i, why: "prompt-exfiltration" },
    { re: /<\|im_(start|end)\|>|<\|system\|>|<\|assistant\|>/i, why: "chatml-breakout" },
    { re: /\[\/?INST\]|<<SYS>>|<<\/SYS>>/i, why: "llama-template-breakout" },
    { re: /\b(you\s+are\s+now|from\s+now\s+on(\s+you\s+are)?)\b[\s\S]{0,40}\b(dan|jailbroken|jailbreak|unrestricted|do\s+anything\s+now|no\s+restrictions?)\b/i, why: "jailbreak-persona" },
];

const MID = [
    { re: /^\s*system\s*:/im, why: "system-role-marker" },
    { re: /\b(developer|assistant)\s+(message|mode|prompt)\b/i, why: "role-impersonation" },
    { re: /\bact\s+as\s+(a|an|the)\b/i, why: "act-as" },
    { re: /\b(jailbreak|do\s+anything\s+now)\b|\bDAN\b/i, why: "jailbreak-term" },
    { re: /\bnew\s+instructions?\s*:/i, why: "new-instructions" },
    { re: /###\s*(system|instruction)/i, why: "markdown-system-header" },
];

/**
 * @param {string[]} strings recursively-collected request strings (direct + indirect)
 * @returns {{confidence:number, evidence:any}|null}
 */
export function detectPromptInjection(strings = []) {
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
            confidence = 1;
            if (!sample) sample = s;
            continue;
        }
        for (const { re, why } of MID) {
            if (re.test(s)) {
                confidence = Math.max(confidence, 0.6);
                if (!hits.includes(why)) hits.push(why);
                if (!sample) sample = s;
            }
        }
    }

    if (confidence <= 0) return null;
    return { confidence, evidence: { patterns: hits, sample: evidence(sample) } };
}
