// GeoLite2 IP → geo/ASN resolution (Phase 2.6).
//
// Backs the impossible-travel detector and enriches threat-intel history. Uses
// MaxMind's free GeoLite2 databases via the pure-JS `maxmind` reader (no native
// build). The .mmdb files are an OFFLINE dependency the operator supplies and
// points at with GEOLITE2_CITY_DB / GEOLITE2_ASN_DB.
//
// FAIL-OPEN by design: if the env vars are unset, the files are missing, the
// reader throws, or the IP is private/unroutable, resolveGeo returns null and
// callers simply skip geo-based logic. GeoLite2 being absent must never break a
// request — this mirrors the advisory/fail-open posture of the rest of Phase 2.
//
// resolveGeo() is synchronous (maxmind readers are sync once opened) so it can be
// called inline on the decision path. Opening is async and done once at startup
// (initGeo, called from the server/worker bootstrap) and also lazily on first
// use; until a reader is ready resolveGeo returns null.

import maxmind from "maxmind";
import ipaddr from "ipaddr.js";

let cityReader = null;
let asnReader = null;
let opening = null; // in-flight open promise (dedupes concurrent lazy opens)

const cityPath = () => process.env.GEOLITE2_CITY_DB || "";
const asnPath = () => process.env.GEOLITE2_ASN_DB || "";

/** True when at least one GeoLite2 db path is configured. */
export const isGeoEnabled = () => Boolean(cityPath() || asnPath());

/**
 * Open the configured GeoLite2 readers once. Safe to call repeatedly and
 * concurrently (deduped). Never throws — a bad/missing path just leaves that
 * reader null so resolveGeo fails open.
 */
export const initGeo = async () => {
    if (!isGeoEnabled()) return;
    if (cityReader || asnReader) return;
    if (opening) return opening;
    opening = (async () => {
        if (cityPath()) {
            try {
                cityReader = await maxmind.open(cityPath());
                console.log("[geo] GeoLite2 City db loaded");
            } catch (e) {
                console.error("[geo] failed to open City db (fail-open):", e?.message || e);
            }
        }
        if (asnPath()) {
            try {
                asnReader = await maxmind.open(asnPath());
                console.log("[geo] GeoLite2 ASN db loaded");
            } catch (e) {
                console.error("[geo] failed to open ASN db (fail-open):", e?.message || e);
            }
        }
    })();
    try {
        await opening;
    } finally {
        opening = null;
    }
};

// Only public, routable IPs are worth resolving — private/loopback/link-local
// addresses aren't in GeoLite2 and would just waste a lookup.
const isPublicIp = (ip) => {
    try {
        return ipaddr.parse(ip).range() === "unicast";
    } catch {
        return false;
    }
};

/**
 * Resolve an IP to { country, lat, lon, asn }. Returns null when geo is disabled,
 * the db isn't ready, the IP is non-public, or anything throws (fail-open).
 *
 * @param {string} ip
 * @param {{city?:object, asn?:object}} [readers] optional overrides for tests
 * @returns {{country:string|null, lat:number|null, lon:number|null, asn:number|null}|null}
 */
export const resolveGeo = (ip, readers) => {
    const city = readers?.city ?? cityReader;
    const asn = readers?.asn ?? asnReader;
    if (!city && !asn) {
        // Not open yet — kick off a lazy open for next time, but don't block.
        if (isGeoEnabled() && !readers) initGeo().catch(() => {});
        return null;
    }
    if (!ip || !isPublicIp(ip)) return null;
    try {
        let country = null;
        let lat = null;
        let lon = null;
        let asnNum = null;
        if (city) {
            const rec = city.get(ip);
            country = rec?.country?.iso_code ?? rec?.registered_country?.iso_code ?? null;
            if (rec?.location) {
                lat = typeof rec.location.latitude === "number" ? rec.location.latitude : null;
                lon = typeof rec.location.longitude === "number" ? rec.location.longitude : null;
            }
        }
        if (asn) {
            const rec = asn.get(ip);
            asnNum = rec?.autonomous_system_number ?? null;
        }
        if (country == null && lat == null && asnNum == null) return null;
        return { country, lat, lon, asn: asnNum };
    } catch (e) {
        return null;
    }
};

/** Test hook: inject/clear readers directly. */
export const _setGeoReaders = ({ city = null, asn = null } = {}) => {
    cityReader = city;
    asnReader = asn;
};
