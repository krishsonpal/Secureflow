import dotenv from "dotenv"
import connectDB from "./db/index.js"
import {app} from "./app.js"
import http from "http"
import { initSocket, getIO } from "./socket.js"
import { startUsageWorker } from "./workers/usageWorker.js"
import { startThreatIntelWorker } from "./workers/threatIntelWorker.js"
import { startFeedIngestWorker } from "./workers/feedIngestWorker.js"
import { initGeo } from "./detection/geo.js"

dotenv.config({
    path: "./.env"
})

// Process-level safety nets: log instead of dying silently. These keep a stray
// rejected promise or thrown async error from taking the whole server down.
process.on("unhandledRejection", (reason) => {
    console.error("[process] unhandledRejection:", reason)
})
process.on("uncaughtException", (err) => {
    console.error("[process] uncaughtException:", err)
})

connectDB().then(
    () =>{
        const server = http.createServer(app);
        initSocket(server);

        // Run the usage-stream worker in-process (laptop/MVP). It can also run as
        // a standalone process via `npm run worker` for scale-out. In-process it
        // gets a socket emitter so dashboard updates keep flowing.
        startUsageWorker((room, payload) => getIO().to(room).emit("dashboard-update", payload))

        // Phase 2.6 — threat-intel pipeline: a second consumer group builds IP
        // reputation/history from attack events, and a scheduler pulls free feeds
        // into the reputation store. Open GeoLite2 (fail-open if unconfigured) so
        // the decision path can resolve geo for impossible-travel.
        initGeo().catch((e) => console.error("[geo] init failed:", e?.message || e))
        startThreatIntelWorker()
        startFeedIngestWorker()

        server.listen(process.env.PORT || 3000,() =>
            console.log("connection made successfully on port", process.env.PORT || 3000)
        )
    }
).catch(
    (err) =>{
        console.error("Failed to start server:", err?.message || err)
        process.exit(1)
    }
)
