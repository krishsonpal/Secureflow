// Download + extract MaxMind GeoLite2 databases into backend/geo/.
//
// MaxMind serves GeoLite2 only as a .tar.gz (no direct .mmdb), so we gunzip and
// pull the .mmdb out of the archive in pure Node (no platform `tar` dependency).
//
// Usage (from backend/):
//   MAXMIND_LICENSE_KEY=xxxx npm run geo:download            # City (default)
//   node scripts/download-geolite2.mjs City ASN              # both editions
// The key can also live in .env as MAXMIND_LICENSE_KEY.
//
// Free key: https://www.maxmind.com/en/geolite2/signup → portal → Manage License
// Keys → generate. Then point GEOLITE2_CITY_DB (+ optionally GEOLITE2_ASN_DB) at
// the extracted files in .env (this script prints the exact lines when done).
import fs from "fs"
import path from "path"
import zlib from "zlib"
import { fileURLToPath } from "url"
import dotenv from "dotenv"

dotenv.config({ path: "./.env" })

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GEO_DIR = path.resolve(__dirname, "..", "geo")

const KEY = process.env.MAXMIND_LICENSE_KEY
if (!KEY) {
    console.error("✗ MAXMIND_LICENSE_KEY not set. Add it to backend/.env or pass it inline:")
    console.error("    MAXMIND_LICENSE_KEY=your_key npm run geo:download")
    process.exit(1)
}

// Editions to fetch (default just City — the only one the Attack Map needs).
const editions = process.argv.slice(2).length ? process.argv.slice(2) : ["City"]

// Minimal tar reader: walk 512-byte headers, return the first entry whose name
// ends with the wanted suffix. GNU/ustar name field is 100 bytes at offset 0;
// size is octal at offset 124 (12 bytes); data is padded to 512-byte blocks.
const extractFromTar = (buf, suffix) => {
    let off = 0
    while (off + 512 <= buf.length) {
        const name = buf.toString("utf8", off, off + 100).replace(/\0.*$/, "")
        if (!name) { off += 512; continue } // zero block (padding/end)
        const sizeStr = buf.toString("utf8", off + 124, off + 136).replace(/\0.*$/, "").trim()
        const size = parseInt(sizeStr, 8) || 0
        const dataStart = off + 512
        if (name.endsWith(suffix)) return buf.subarray(dataStart, dataStart + size)
        off = dataStart + Math.ceil(size / 512) * 512
    }
    return null
}

const download = async (edition) => {
    const editionId = `GeoLite2-${edition}`
    const url = `https://download.maxmind.com/app/geoip_download?edition_id=${editionId}&license_key=${encodeURIComponent(KEY)}&suffix=tar.gz`
    process.stdout.write(`→ ${editionId}: downloading… `)
    const res = await fetch(url, { redirect: "follow" })
    if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status} for ${editionId}${res.status === 401 ? " (bad/again-check license key)" : ""} ${body.slice(0, 120)}`)
    }
    const gz = Buffer.from(await res.arrayBuffer())
    const tar = zlib.gunzipSync(gz)
    const mmdb = extractFromTar(tar, `${editionId}.mmdb`)
    if (!mmdb) throw new Error(`${editionId}.mmdb not found in archive`)
    fs.mkdirSync(GEO_DIR, { recursive: true })
    const out = path.join(GEO_DIR, `${editionId}.mmdb`)
    fs.writeFileSync(out, mmdb)
    console.log(`extracted → ${out} (${(mmdb.length / 1e6).toFixed(1)} MB)`)
    return out
}

const main = async () => {
    const written = {}
    for (const e of editions) written[e] = await download(e)
    console.log("\n✓ Done. Add these to backend/.env (absolute paths), then restart the backend:")
    if (written.City) console.log(`    GEOLITE2_CITY_DB=${written.City}`)
    if (written.ASN) console.log(`    GEOLITE2_ASN_DB=${written.ASN}`)
    console.log("\nThen drive a request from a PUBLIC IP and check /geo — countries will populate.")
}

main().catch((e) => { console.error("\n✗", e.message); process.exit(1) })
