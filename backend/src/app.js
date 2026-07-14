import express from "express"
import cors from "cors"
import helmet from "helmet"
import cookieParser from "cookie-parser"
import mongoose from "mongoose"
import Redis from 'ioredis'

import userRouter from "./routes/user.routes.js"
import projectRouter from "./routes/project.routes.js"
import apirouter from "./routes/apikey.routes.js"
import servicerouter from "./routes/bonding.routes.js"
import { globalRateLimit } from "./middleware/globalRateLimit.middleware.js"



const app = express()

// Trust the first proxy hop so req.ip reflects the real client (X-Forwarded-For)
// rather than the load balancer. The per-IP rate limiters key off req.ip, so an
// untrusted proxy setup would otherwise bucket every client under one IP.
app.set("trust proxy", 1)



const redis = new Redis(process.env.REDIS_URL || undefined)

// Never let a Redis connection error surface as an unhandled event and crash
// the process — log it and let ioredis retry.
redis.on("error", (err) => {
  console.error("[redis] connection error:", err?.message || err)
})

// Allowed CORS origins (explicit list — no wildcard). Shared shape used by the
// Socket.io server in socket.js.
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173,http://localhost:4000")
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

app.use(helmet())
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
// app.use(express.static())
app.use(cookieParser())

// --- Health probes ---
// Liveness: process is up and serving. Cheap, no dependencies.
app.get("/healthz", (req, res) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() })
})

// Readiness: only "ready" when Mongo and Redis are both reachable.
app.get("/readyz", async (req, res) => {
    const mongoUp = mongoose.connection?.readyState === 1
    let redisUp = false
    try {
        redisUp = (await redis.ping()) === "PONG"
    } catch {
        redisUp = false
    }
    const ready = mongoUp && redisUp
    res.status(ready ? 200 : 503).json({
        status: ready ? "ready" : "not-ready",
        mongo: mongoUp ? "up" : "down",
        redis: redisUp ? "up" : "down"
    })
})

// --- Global per-IP backstop ---
// Applied to all API traffic (health probes above stay unlimited for monitoring).
// Runs before per-identity limits so a key/session-rotating flood is capped here.
app.use("/api/v1", globalRateLimit)

// --- API routes ---
app.use("/api/v1/users", userRouter)
app.use("/api/v1/projects",projectRouter)
app.use("/api/v1/apikey",apirouter)
app.use("/api/v1/service",servicerouter)


// --- Global error handler ---
// MUST be registered AFTER the routers so Express actually routes thrown/passed
// errors here (previously it sat before the routes and never fired).
app.use((err, req, res, next) => {
    const statusCode = err.statuscode || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    return res.status(statusCode).json({
        success: false,
        statuscode: statusCode,
        message: message,
        errors: err.errors || [],
        data: null
    });
});


export { app ,redis }
