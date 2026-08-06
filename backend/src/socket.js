import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { resolveUserFromToken } from "./utils/verifyAccessToken.js";
import { Project } from "./models/project.model.js";

let io;

// Explicit allowed origins — no wildcard. Prefers CORS_ORIGIN, then the
// FRONTEND_URL list, then a safe localhost default for dev.
const socketOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || "http://localhost:5173,http://localhost:4000")
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

// Pull the access token off a handshake: prefer the explicit `auth.token`
// (what the SPA sends), fall back to the httpOnly `accessToken` cookie.
const getHandshakeToken = (socket) => {
    const authToken = socket.handshake.auth?.token;
    if (authToken) return String(authToken).replace(/^Bearer\s+/i, "").trim();

    const cookie = socket.handshake.headers?.cookie;
    if (cookie) {
        const m = cookie.match(/(?:^|;\s*)accessToken=([^;]+)/);
        if (m) return decodeURIComponent(m[1]);
    }
    return null;
};

// Build the Redis pub/sub adapter so emits fan out across processes (the API
// server AND standalone workers). Dedicated connections — never the shared
// command client, which the adapter would monopolise for pub/sub.
const attachRedisAdapter = (server) => {
    const pub = new Redis(process.env.REDIS_URL || undefined);
    const sub = pub.duplicate();
    pub.on("error", (e) => console.error("[socket] redis pub error:", e?.message || e));
    sub.on("error", (e) => console.error("[socket] redis sub error:", e?.message || e));
    server.adapter(createAdapter(pub, sub));
};

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: socketOrigins,
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    attachRedisAdapter(io);

    // --- Authenticated handshake ---
    // Reject any socket that doesn't present a valid access token. The resolved
    // user (incl. organizationId/role) rides on socket.data for authorization.
    io.use(async (socket, next) => {
        try {
            const user = await resolveUserFromToken(getHandshakeToken(socket));
            socket.data.user = user;
            next();
        } catch (err) {
            next(new Error(`unauthorized: ${err.message}`));
        }
    });

    io.on("connection", (socket) => {
        const user = socket.data.user;
        console.log(`Socket connected: ${socket.id} (user ${user?._id})`);

        // --- Room authorization ---
        // The room id is client-supplied; never trust it. Only let the socket join
        // a project room it actually owns / belongs to (same organization). Ack the
        // result so the client knows; also emit join-error for ack-less clients.
        socket.on("join-project", async (projectId, ack) => {
            try {
                if (!projectId) {
                    ack?.({ ok: false, error: "projectId required" });
                    return socket.emit("join-error", { projectId, error: "projectId required" });
                }

                const project = await Project.findById(projectId).select("organizationId userId");
                if (!project) {
                    ack?.({ ok: false, error: "project not found" });
                    return socket.emit("join-error", { projectId, error: "project not found" });
                }

                const sameOrg =
                    project.organizationId && user.organizationId &&
                    project.organizationId.toString() === user.organizationId.toString();
                const isOwner =
                    project.userId && project.userId.toString() === user._id.toString();

                if (!sameOrg && !isOwner) {
                    console.warn(`Socket ${socket.id} (user ${user._id}) denied room ${projectId}`);
                    ack?.({ ok: false, error: "forbidden" });
                    return socket.emit("join-error", { projectId, error: "forbidden" });
                }

                const room = projectId.toString();
                socket.join(room);
                ack?.({ ok: true, room });
                socket.emit("joined", { projectId: room });
                console.log(`Socket ${socket.id} joined project room: ${room}`);
            } catch (err) {
                console.error("[socket] join-project error:", err?.message || err);
                ack?.({ ok: false, error: "join failed" });
                socket.emit("join-error", { projectId, error: "join failed" });
            }
        });

        socket.on("disconnect", () => {
            console.log("Client disconnected:", socket.id);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error("Socket.io is not initialized!");
    }
    return io;
};
