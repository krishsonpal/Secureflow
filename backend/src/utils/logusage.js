import { ApiKey } from "../models/apikey.model.js";
import { APIUsage } from "../models/apiusage.model.js";
import { getIO } from "../socket.js"; 

/**
 * Global Utility for logging and real-time dashboard updates
 * @param {string} apiKeyString - The raw API key string or ID
 * @param {string} fingerprint - The device fingerprint
 * @param {string} status - "success" | "failed" | "locked" | "rate-limited" | "xss" | "session-theft" | "bot"
 * @param {string} message - A detailed message explaining the log (optional)
 */
export const logUsageAsync = async (apiKeyString, fingerprint, status, message = "") => {
    try {
        // 1. Find the project ID associated with this API key
        // We use lean() for better performance as we only need the IDs
        const keyDoc = await ApiKey.findOne({ key: apiKeyString }).select("projectId");
        
        if (!keyDoc) {
            console.warn(`Logging failed: Invalid API Key ${apiKeyString}`);
            return;
        }

        const projectId = keyDoc.projectId;

        // 2. Create the log entry in Mongoose
        const usage = await APIUsage.create({
            apiKey: keyDoc._id,
            projectId: projectId,
            fingerprint,
            status,
            message
        });

        // 3. Emit real-time data to Socket.io
        // We broadcast only to the room belonging to this specific Project
        const io = getIO();
        io.to(projectId.toString()).emit("dashboard-update", {
            id: usage._id,
            fingerprint: usage.fingerprint,
            status: usage.status,
            message: usage.message,
            timestamp: usage.createdAt
        });

    } catch (error) {
        // Since this is an async background task, we log locally to avoid 
        // interrupting the main response flow
        console.error("Critical Logging Error:", error.message);
    }
};