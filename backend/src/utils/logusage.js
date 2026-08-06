import { publishUsageEvent } from "../events/usageStream.js";

/**
 * Record a usage/security event. This now publishes to a Redis Stream and
 * returns immediately — the Mongo write + Socket.io emit happen in the
 * usage worker (workers/usageWorker.js), off the request hot path.
 *
 * @param {string|null} apiKeyString - The raw (plaintext) API key OR null if apiKeyId is supplied
 * @param {string} fingerprint       - The device fingerprint
 * @param {string} status            - success | failed | locked | rate-limited | xss | session-theft | bot | blocked
 * @param {string} [message]         - Optional detail
 * @param {{riskScore?:number, action?:string, topSignal?:string, ip?:string, apiKeyId?:string}} [meta]
 *   Phase 2.1/2.6 decision metadata. Pass `apiKeyId` (MongoDB ObjectId string already resolved by
 *   checkuserlimit via req.apiKeyId) so the worker skips the re-hash DB lookup.
 */
export const logUsageAsync = async (apiKeyString, fingerprint, status, message = "", meta = {}) => {
    await publishUsageEvent({ apiKey: apiKeyString, fingerprint, status, message, ...meta });
};
