// Feed-ingest worker (Phase 2.6).
//
// Periodically pulls FREE IP-reputation feeds into the FeedStore so the decision
// path can flag known-bad sources. No paid feeds. Each feed is fetched and
// applied INDEPENDENTLY and fail-open — a network error on one feed logs and
// skips it without affecting the others or the request path.
//
//   Tor exit list      → exact-IP set   (source "tor")
//   abuse.ch Feodo      → exact-IP set   (source "abusech")   botnet C2 IPs
//   FireHOL level1      → CIDR matcher   (source "firehol")   ranges, NOT expanded
//
// This introduces the app's only scheduler: mirror of startUsageWorker's
// lifecycle (running flag + start/stop) but time-driven via setInterval.

import axios from "axios";
import ipaddr from "ipaddr.js";
import { FeedStore } from "../detection/reputation.js";

const ENABLED = (process.env.THREAT_FEEDS ?? "on") !== "off";
const REFRESH_MS = Number(process.env.FEED_REFRESH_MS ?? 6 * 3600 * 1000); // 6h
// TTL longer than the refresh interval so a stale feed self-expires if ingest
// stops, but is normally refreshed well before expiry.
const FEED_TTL_S = Math.ceil((REFRESH_MS / 1000) * 2);
const MAX_ENTRIES = Number(process.env.FEED_MAX_ENTRIES ?? 50000);

const TOR_URL = process.env.TOR_EXIT_URL ?? "https://check.torproject.org/torbulkexitlist";
const ABUSECH_URL = process.env.ABUSECH_URL ?? "https://feodotracker.abuse.ch/downloads/ipblocklist.txt";
const FIREHOL_URL =
    process.env.FIREHOL_URL ??
    "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset";

let running = false;
let timer = null;

// Split a feed body into non-comment, non-blank trimmed lines.
const parseLines = (text) =>
    String(text)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && !l.startsWith(";"));

const isIp = (s) => {
    try {
        ipaddr.parse(s);
        return true;
    } catch {
        return false;
    }
};

// Wrap a feed ingest so one failure never breaks the others.
const safe = async (label, fn) => {
    try {
        const n = await fn();
        console.log(`[feedIngest] ${label}: ${n} entries`);
    } catch (e) {
        console.error(`[feedIngest] ${label} failed (skipped):`, e?.message || e);
    }
};

const ingestExact = async (url, source, fetcher) => {
    const res = await fetcher.get(url, { timeout: 20000, responseType: "text" });
    const ips = parseLines(res.data)
        .filter((l) => !l.includes("/") && isIp(l))
        .slice(0, MAX_ENTRIES);
    return FeedStore.setExactBatch(ips, source, FEED_TTL_S);
};

const ingestFirehol = async (url, fetcher) => {
    const res = await fetcher.get(url, { timeout: 20000, responseType: "text" });
    const cidrs = parseLines(res.data)
        // Bare IPs → /32; keep CIDRs as-is. ipaddr.js validates on parse in the
        // FeedStore, so malformed lines are dropped there.
        .map((l) => (l.includes("/") ? l : `${l}/32`))
        .filter((l) => {
            try {
                ipaddr.parseCIDR(l);
                return true;
            } catch {
                return false;
            }
        })
        .slice(0, MAX_ENTRIES);
    return FeedStore.setCidrs(cidrs, FEED_TTL_S);
};

const ingest = async (fetcher) => {
    await safe("tor", () => ingestExact(TOR_URL, "tor", fetcher));
    await safe("abusech", () => ingestExact(ABUSECH_URL, "abusech", fetcher));
    await safe("firehol", () => ingestFirehol(FIREHOL_URL, fetcher));
};

/**
 * Start the periodic feed ingest. `fetcher` is injectable (defaults to axios) so
 * tests drive it with canned feed bodies and no network.
 */
export const startFeedIngestWorker = ({ fetcher = axios } = {}) => {
    if (running) return;
    if (!ENABLED) {
        console.log("[feedIngest] disabled (THREAT_FEEDS=off)");
        return;
    }
    running = true;
    console.log(`[feedIngest] started; refresh every ${Math.round(REFRESH_MS / 1000)}s`);
    // Immediate first ingest, then on an interval. Fire-and-forget; failures are
    // swallowed per-feed inside ingest().
    ingest(fetcher).catch((e) => console.error("[feedIngest] initial ingest error:", e?.message || e));
    timer = setInterval(() => {
        ingest(fetcher).catch((e) => console.error("[feedIngest] ingest error:", e?.message || e));
    }, REFRESH_MS);
    if (timer.unref) timer.unref(); // don't keep the event loop alive on its own
};

export const stopFeedIngestWorker = async () => {
    running = false;
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
};

// Exposed for tests / manual runs.
export const _ingestOnce = ingest;
