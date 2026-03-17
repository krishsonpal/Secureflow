import { asyncHandler } from "../utils/asyncHandler.js";
import { logUsageAsync } from "../utils/logusage.js";

export const detectBot = asyncHandler(async (req, res, next) => {
    const userAgent = req.headers['user-agent'] || '';
    const fingerprint = req.body.fingerprint;
    const apiKey = req.body.apiKey;

    // 1. Known Bot Signatures (User-Agent Check)
    const botPatterns = [
        /bot/i, /crawler/i, /spider/i, /headless/i, /puppeteer/i, 
        /selenium/i, /python/i, /postman/i, /curl/i
    ];
    
    const isBotUA = botPatterns.some(pattern => pattern.test(userAgent));

    // Automated Browser Flags (Check for FingerprintJS anomalies)
    // FingerprintJS,provides a "bot" flag.
    // If the fingerprint itself is missing or too generic, it's suspicious.
    const isSuspiciousFingerprint = !fingerprint || fingerprint.length < 10;

    // Header Checks
    // Real browsers usually send specific headers that basic bots skip
    const hasSecFetch = req.headers['sec-fetch-dest'];
    const isAutomatedTool = !hasSecFetch && !userAgent.includes("Mozilla");

    if (isBotUA || isSuspiciousFingerprint || isAutomatedTool) {
        // We block them with a 403 Forbidden
        // You can also log this as "failed" using your logUsageAsync

        let botReason = "Automated access detected. Please use a standard browser.";
        if (isBotUA) botReason = "Suspicious User-Agent matched known bot signatures.";
        if (isSuspiciousFingerprint) botReason = "Browser fingerprint is missing or abnormally generic.";

        await logUsageAsync(apiKey, fingerprint, "bot", botReason);

        return res.status(403).json({
            success: false,
            message: "Automated access detected. Please use a standard browser.",
            isBot: true
        });
    }

    next();
});