import axios from "axios";
import { logUsageAsync } from "../utils/logusage.js";

// How long to wait on the ML service before giving up (ms).
const ML_TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS) || 1500;

export const checkXSS = async (req, res, next) => {
    try {

        const  input  = req.body.requestdata;

        // Nothing to scan → don't block; let the rest of the pipeline run.
        if (input === undefined || input === null || input === "") {
            return next();
        }

        const response = await axios.post(
            process.env.MICROSERVICE_URI,
            { content: input },
            { timeout: ML_TIMEOUT_MS }
        );

        if (response.data.prediction === 1) {
            const { apiKey, fingerprint } = req.body;
            if (apiKey && fingerprint) {
                await logUsageAsync(apiKey, fingerprint, "xss", "Malicious payload detected by AI model");
            }
            return res.status(403).json({
                message: "XSS Detected",
                details: response.data
            });
        }

        next(); // continue to next middleware/controller

    } catch (error) {
        // FAIL OPEN: the ML service is a security add-on, not a hard dependency.
        // If it's slow/down/unreachable, degrade gracefully and let the request
        // proceed rather than denying 100% of the customer's traffic.
        console.warn("[checkXSS] ML service unavailable, failing open:", error?.code || error?.message || error);
        next();
    }
};
