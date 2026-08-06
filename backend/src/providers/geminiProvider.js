import axios from "axios";
import {
    DetectionProvider,
    buildClassifyPrompt,
    extractJSON,
    normalizeClassification,
} from "./DetectionProvider.js";
import { CircuitBreaker } from "../utils/circuitBreaker.js";

// Cloud fallback provider (Phase 2.4). Google Generative Language REST API (free
// tier): :generateContent (classify) + :embedContent (embed). Selected only when
// AI_PROVIDER=gemini — the user controls local-vs-cloud explicitly. Requires
// GEMINI_API_KEY; missing key makes calls throw (→ the chain degrades to the
// heuristic floor). http is injectable for tests.
export class GeminiProvider extends DetectionProvider {
    constructor({ http = axios, env = process.env } = {}) {
        super("gemini");
        this.http = http;
        this.apiKey = env.GEMINI_API_KEY || "";
        this.model = env.GEMINI_MODEL || "gemini-1.5-flash";
        this.embedModel = env.GEMINI_EMBED_MODEL || "text-embedding-004";
        this.base = "https://generativelanguage.googleapis.com/v1beta";
        this.timeout = Number(env.AI_TIMEOUT_MS) || 8000;
        this.breaker = new CircuitBreaker({ name: "gemini", failureThreshold: 3, cooldownMs: 30000 });
    }

    _requireKey() {
        if (!this.apiKey) throw new Error("gemini: GEMINI_API_KEY not set");
    }

    async classify(text, task) {
        this._requireKey();
        const res = await this.http.post(
            `${this.base}/models/${this.model}:generateContent?key=${this.apiKey}`,
            {
                contents: [{ role: "user", parts: [{ text: buildClassifyPrompt(text, task) }] }],
                generationConfig: { temperature: 0, responseMimeType: "application/json" },
            },
            { timeout: this.timeout }
        );
        const parts = res?.data?.candidates?.[0]?.content?.parts;
        const completion = Array.isArray(parts) ? parts.map((p) => p?.text || "").join("") : "";
        return normalizeClassification(extractJSON(completion), "benign");
    }

    async embed(text) {
        this._requireKey();
        const res = await this.http.post(
            `${this.base}/models/${this.embedModel}:embedContent?key=${this.apiKey}`,
            { model: `models/${this.embedModel}`, content: { parts: [{ text: String(text ?? "") }] } },
            { timeout: this.timeout }
        );
        const vec = res?.data?.embedding?.values;
        if (!Array.isArray(vec)) throw new Error("gemini: no embedding in response");
        return vec.map(Number);
    }

    async healthy() {
        return Boolean(this.apiKey);
    }
}
