import { publishUsageEvent } from "../events/usageStream.js";

/**
 * Record a usage/security event. This now publishes to a Redis Stream and
 * returns immediately — the Mongo write + Socket.io emit happen in the
 * usage worker (workers/usageWorker.js), off the request hot path.
 *
 * Signature is unchanged so every existing caller keeps working.
 *
 * @param {string} apiKeyString - The raw (plaintext) API key
 * @param {string} fingerprint  - The device fingerprint
 * @param {string} status       - success | failed | locked | rate-limited | xss | session-theft | bot | blocked
 * @param {string} [message]    - Optional detail
 * @param {{riskScore?:number, action?:string, topSignal?:string}} [meta] - Phase 2.1 decision metadata
 */
export const logUsageAsync = async (apiKeyString, fingerprint, status, message = "", meta = {}) => {
    await publishUsageEvent({ apiKey: apiKeyString, fingerprint, status, message, ...meta });
};
