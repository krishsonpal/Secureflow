import { Server } from "socket.io";

let io;

// Explicit allowed origins — no wildcard. Prefers CORS_ORIGIN, then the
// FRONTEND_URL list, then a safe localhost default for dev.
const socketOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || "http://localhost:5173,http://localhost:4000")
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: socketOrigins,
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    io.on("connection", (socket) => {
        console.log("Client connected to socket:", socket.id);


        socket.on("join-project", (projectId) => {
            socket.join(projectId);
            console.log(`Socket ${socket.id} joined project room: ${projectId}`);
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
