import crypto from "crypto"

// Deterministic one-way hash used for at-rest secrets we still need to look up
// or compare by equality (refresh tokens, API keys). Not a password — no salt —
// so it stays comparable, but a DB leak no longer exposes the usable secret.
export const hashToken = (token) =>
    crypto.createHash("sha256").update(String(token)).digest("hex")

export const API_KEY_PREFIX = "sk_live_"

// Generate a new API key. The caller stores { hash, prefix } and returns `full`
// to the user exactly once — the plaintext is never persisted or retrievable.
export const generateApiKey = () => {
    const secret = crypto.randomBytes(24).toString("hex") // 48 hex chars
    const full = API_KEY_PREFIX + secret
    return {
        full,
        hash: hashToken(full),
        prefix: full.slice(0, API_KEY_PREFIX.length + 6) + "…" // e.g. sk_live_ab12cd…
    }
}
