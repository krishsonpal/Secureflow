import dotenv from "dotenv"
dotenv.config({ path: "./.env" })

import connectDB from "../db/index.js"
import { startUsageWorker } from "./usageWorker.js"
import { startThreatIntelWorker } from "./threatIntelWorker.js"
import { startFeedIngestWorker } from "./feedIngestWorker.js"
import { initGeo } from "../detection/geo.js"
import { createRedisEmitter } from "../utils/socketEmitter.js"

// Standalone worker process (for scale-out). As of Part 1.7 it emits dashboard
// updates too, via a serverless Socket.io + Redis-adapter emitter that fans out
// to the API server's connected sockets. Run with: npm run worker
connectDB()
    .then(async () => {
        const emit = createRedisEmitter()
        await startUsageWorker(emit) // persists AND emits across processes
        // Phase 2.6 threat-intel pipeline in the scale-out process too.
        await initGeo().catch((e) => console.error("[geo] init failed:", e?.message || e))
        await startThreatIntelWorker()
        startFeedIngestWorker()
        console.log("[worker] standalone usage + threat-intel workers running (with cross-process emit)")
    })
    .catch((err) => {
        console.error("[worker] failed to start:", err?.message || err)
        process.exit(1)
    })

process.on("unhandledRejection", (r) => console.error("[worker] unhandledRejection:", r))
process.on("uncaughtException", (e) => console.error("[worker] uncaughtException:", e))
