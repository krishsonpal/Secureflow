// Impossible-travel detector (Phase 2.6) — a strong account-takeover signal.
//
// Stateful counterpart to the stateless JWT-abuse detector (2.3): where that
// flags a *tampered* token, this flags the SAME identity (server-trusted API-key
// hash, or a token/jti) appearing from geographically impossible locations in a
// short window — classic credential theft / session replay across continents.
//
// Redis holds the last-seen { lat, lon, country, ts } per identity (TTL'd, so it
// decays). On each request we compute the great-circle distance to the previous
// location and the implied speed. FAILS OPEN (returns null) on any error, when
// geo is unavailable, or when there's no stable identity to key on.

import { redis as defaultRedis } from "../../app.js";

// Only meaningful, corroborated travel counts. IT_MIN_KM is a hard distance gate
// FIRST — under it we don't even compute speed. This filters GeoIP jitter (the
// same city resolving tens of km apart) and legitimate small regional moves; 200
// km still catches genuine long-haul travel well before it becomes suspicious.
const IT_MIN_KM = Number(process.env.IT_MIN_KM ?? 200);
// Fastest plausible ground/air travel — commercial cruise ~900 km/h plus slack.
// Past the distance gate, an implied speed above this is "impossible".
const IT_MAX_KMH = Number(process.env.IT_MAX_KMH ?? 1000);
const IT_TTL_S = Number(process.env.IT_TTL_S ?? 43200); // 12h last-seen retention

const KEY = (identity) => `it:${identity}`;
const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

// Great-circle (haversine) distance in km between two {lat,lon} points.
const haversineKm = (a, b) => {
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * @param {{identity:string, geo:{lat:number,lon:number,country?:string}, redis?:object, now?:number}} params
 * @returns {Promise<{confidence:number, evidence:object}|null>}
 */
export const detectImpossibleTravel = async ({ identity, geo, redis = defaultRedis, now = Date.now() } = {}) => {
    if (!identity || !geo || typeof geo.lat !== "number" || typeof geo.lon !== "number") return null;

    const key = KEY(identity);
    let signal = null;
    try {
        const raw = await redis.get(key);
        if (raw) {
            const last = JSON.parse(raw);
            if (typeof last?.lat === "number" && typeof last?.lon === "number") {
                const distanceKm = haversineKm(last, geo);
                // Distance gate FIRST — under IT_MIN_KM, ignore outright (no speed math).
                if (distanceKm >= IT_MIN_KM) {
                    const hours = Math.max((now - Number(last.ts || now)) / 3_600_000, 1 / 3600);
                    const kmh = distanceKm / hours;
                    if (kmh > IT_MAX_KMH) {
                        // Marginally-impossible → challenge (0.6); wildly-impossible → block (→1.0).
                        const confidence = clamp01(0.6 + 0.4 * Math.min(1, (kmh - IT_MAX_KMH) / IT_MAX_KMH));
                        signal = {
                            confidence,
                            evidence: {
                                fromCountry: last.country ?? null,
                                toCountry: geo.country ?? null,
                                distanceKm: Math.round(distanceKm),
                                kmh: Math.round(kmh),
                            },
                        };
                    }
                }
            }
        }

        // Upsert last-seen (decays via TTL) regardless of verdict.
        await redis.set(
            key,
            JSON.stringify({ lat: geo.lat, lon: geo.lon, country: geo.country ?? null, ts: now }),
            "EX",
            IT_TTL_S
        );
    } catch (e) {
        return null; // fail-open
    }
    return signal;
};
