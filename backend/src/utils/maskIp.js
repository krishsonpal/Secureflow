import ipaddr from "ipaddr.js"
import { hashToken } from "./tokens.js"

// Phase 3.10 (Dashboard V2) — privacy-conscious client-IP storage.
//
// A raw client IP is PII, but the Attack Map needs only the country (resolved
// separately via GeoLite2) and the Threat Explorer benefits from a stable, and
// still de-identified, per-origin key. IP_STORE_MODE governs what we persist:
//
//   truncated (DEFAULT) — zero the host portion (IPv4 /24, IPv6 /48). Keeps
//                         subnet grouping/filtering, drops the identifying host.
//   full                — store the raw IP verbatim (explicit opt-in).
//   hash                — one-way sha256 (hashToken); equality-searchable, opaque.
//   none                — store nothing (ip stays null; ip filters become no-ops).
//
// FAIL-OPEN: an empty/unparseable input returns null rather than persisting a
// bogus value — never let masking throw on the worker path.
export const ipStoreMode = () => (process.env.IP_STORE_MODE || "truncated").toLowerCase()

export const maskIp = (ip, mode = ipStoreMode()) => {
    if (!ip) return null
    const raw = String(ip).trim()
    if (!raw) return null

    switch (mode) {
        case "none":
            return null
        case "full":
            return raw
        case "hash":
            try { return hashToken(raw) } catch { return null }
        case "truncated":
        default:
            try {
                let addr = ipaddr.parse(raw)
                // Normalize an IPv4-mapped IPv6 (::ffff:1.2.3.4) down to IPv4 so
                // it truncates as a /24 like any other IPv4 address.
                if (addr.kind() === "ipv6" && addr.isIPv4MappedAddress()) addr = addr.toIPv4Address()

                if (addr.kind() === "ipv4") {
                    const o = addr.octets
                    return `${o[0]}.${o[1]}.${o[2]}.0`
                }
                // IPv6 → keep the /48 network prefix (first 3 hextets), zero the rest.
                const parts = addr.parts.slice()
                for (let i = 3; i < parts.length; i++) parts[i] = 0
                return new ipaddr.IPv6(parts).toNormalizedString()
            } catch {
                return null
            }
    }
}
