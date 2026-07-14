import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";

/**
 * Build a cross-process dashboard emitter for a worker that has NO HTTP server.
 *
 * A serverless Socket.io `Server` wired to the same Redis adapter as the API
 * server publishes emit commands to Redis; the real server (where the browsers
 * are connected) receives them and delivers to its local sockets. This is what
 * lets the standalone `npm run worker` push `dashboard-update` — previously it
 * could persist events but never emit (Part 1.4 limitation, resolved in 1.7).
 *
 * @returns {(room: string, payload: any) => void} emit(room, payload)
 */
export const createRedisEmitter = () => {
    const io = new Server(); // no httpServer — used purely as an emit source
    const pub = new Redis(process.env.REDIS_URL || undefined);
    const sub = pub.duplicate();
    pub.on("error", (e) => console.error("[socketEmitter] redis pub error:", e?.message || e));
    sub.on("error", (e) => console.error("[socketEmitter] redis sub error:", e?.message || e));
    io.adapter(createAdapter(pub, sub));

    return (room, payload) => io.to(room).emit("dashboard-update", payload);
};
