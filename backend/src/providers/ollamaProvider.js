import axios from "axios";
import {
    DetectionProvider,
    buildClassifyPrompt,
    extractJSON,
    normalizeClassification,
} from "./DetectionProvider.js";
import { CircuitBreaker } from "../utils/circuitBreaker.js";

// Local, default provider (Phase 2.4). Talks to a local Ollama daemon:
//   POST /api/generate   (classify — constrained JSON completion)
//   POST /api/embeddings (embed  — nomic-embed-text by default)
// http is injectable so tests can supply a fake transport (no live LLM).
export class OllamaProvider extends DetectionProvider {
    constructor({ http = axios, env = process.env } = {}) {
        super("ollama");
        this.http = http;
        this.url = (env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "");
        this.model = env.OLLAMA_MODEL || "qwen2.5:7b";
        this.embedModel = env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
        this.timeout = Number(env.AI_TIMEOUT_MS) || 8000;
        this.breaker = new CircuitBreaker({ name: "ollama", failureThreshold: 3, cooldownMs: 30000 });
    }

    async classify(text, task) {
        const res = await this.http.post(
            `${this.url}/api/generate`,
            {
                model: this.model,
                prompt: buildClassifyPrompt(text, task),
                stream: false,
                format: "json",
                options: { temperature: 0 },
            },
            { timeout: this.timeout }
        );
        return normalizeClassification(extractJSON(res?.data?.response ?? ""), "benign");
    }

    async embed(text) {
        const res = await this.http.post(
            `${this.url}/api/embeddings`,
            { model: this.embedModel, prompt: String(text ?? "") },
            { timeout: this.timeout }
        );
        const vec = res?.data?.embedding;
        if (!Array.isArray(vec)) throw new Error("ollama: no embedding in response");
        return vec.map(Number);
    }

    async healthy() {
        try {
            await this.http.get(`${this.url}/api/tags`, { timeout: this.timeout });
            return true;
        } catch {
            return false;
        }
    }
}
