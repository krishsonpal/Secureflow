// Confidence check for the GeoLite2 wiring: loads the configured City db and
// resolves a few known public IPs. Run after `npm run geo:download`:
//   npm run geo:verify
// Exits non-zero (with guidance) if geo is unconfigured or resolves nothing.
import dotenv from "dotenv"
dotenv.config({ path: "./.env" })
import { initGeo, isGeoEnabled, resolveGeo } from "../src/detection/geo.js"

const SAMPLES = [
    { ip: "8.8.8.8", note: "Google DNS (expect US)" },
    { ip: "1.1.1.1", note: "Cloudflare (expect US/AU)" },
    { ip: "128.101.101.101", note: "Univ. of Minnesota (expect US)" },
]

const main = async () => {
    if (!isGeoEnabled()) {
        console.error("✗ Geo not enabled — set GEOLITE2_CITY_DB in backend/.env (see scripts/download-geolite2.mjs).")
        process.exit(1)
    }
    await initGeo()
    let resolved = 0
    for (const s of SAMPLES) {
        const g = resolveGeo(s.ip)
        if (g?.country) resolved++
        console.log(`  ${s.ip.padEnd(16)} → ${g ? `${g.country ?? "?"} (lat ${g.lat}, lon ${g.lon})` : "null"}   ${s.note}`)
    }
    if (resolved === 0) {
        console.error("\n✗ The db is configured but resolved no countries — is the .mmdb valid / the path correct?")
        process.exit(1)
    }
    console.log(`\n✓ GeoLite2 working — resolved ${resolved}/${SAMPLES.length}. Restart the backend and drive a request from a public IP; /geo + the Attack Map will populate.`)
    process.exit(0)
}

main().catch((e) => { console.error("✗", e.message); process.exit(1) })
