import dotenv from "dotenv"
dotenv.config({ path: "./.env" })

import connectDB from "../db/index.js"
import { startUsageWorker } from "./usageWorker.js"

// Standalone worker process (for scale-out). Note: without the Socket.io Redis
// adapter (Part 1.7) this process can persist events but cannot emit dashboard
// updates — so for the single-node MVP prefer the in-process worker started by
// src/index.js. Run with: npm run worker
connectDB()
    .then(async () => {
        await startUsageWorker() // no emitter → persistence only
        console.log("[worker] standalone usage worker running")
    })
    .catch((err) => {
        console.error("[worker] failed to start:", err?.message || err)
        process.exit(1)
    })

process.on("unhandledRejection", (r) => console.error("[worker] unhandledRejection:", r))
process.on("uncaughtException", (e) => console.error("[worker] uncaughtException:", e))
