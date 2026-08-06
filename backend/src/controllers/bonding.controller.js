import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { redis } from "../app.js"
import { ApiKey } from "../models/apikey.model.js";
import { logUsageAsync } from "../utils/logusage.js";
import { ClientUserSchema } from "../models/clientuser.model.js";
import { APIUsage } from "../models/apiusage.model.js";
import {sendEmail} from "../utils/sendEmail.js"
import { hashToken } from "../utils/tokens.js"
import { loadSecurityRule } from "../utils/securityRule.js"
import crypto from "crypto";


const processPostLoginTasks = async (data) => {
    try {
        const { email, fingerprint, apiKeyId } = data;

        const keyDoc = await ApiKey.findOne({ key: hashToken(apiKeyId) }).populate("projectId");

        if (!keyDoc) return;

        const projectId = keyDoc.projectId;
        const organizationId = keyDoc.organizationId;

        const existingUser = await ClientUserSchema.findOne({
            fingerPrint: fingerprint,
            projectId: projectId
        });


        if (!existingUser) {
            await ClientUserSchema.create({
                fingerPrint: fingerprint,
                projectId: projectId,
                organizationId: organizationId
            });
            sendEmail(email,"New device register")


        }

        const usage = await APIUsage.create({
            apiKey: keyDoc._id,
            projectId: projectId,
            organizationId: organizationId,
            fingerprint: fingerprint,
            status: "success"
        });

        // 4. Trigger Socket.io event for real-time dashboard
        // const io = getIO();
        // io.to(projectId.toString()).emit("usage-update", usage);

        // 5. Send Email Notification
        // await sendEmail(email, "New Login Detected", `Device Fingerprint: ${fingerprint}`);
        
    } catch (error) {
        console.error("Post-Login Async Error:", error);
    }
};

const registerLoginSuccess = asyncHandler(async (req, res) => {
    const { email, sessionId, fingerprint, apiKey } = req.body;

    if ([email, sessionId, fingerprint, apiKey].some((field) => field?.trim() === "")) {
        throw new APIError(400, "All fields are required");
    }

    await redis.set(`session:${sessionId}`, fingerprint, 'EX', 86400);

    processPostLoginTasks({ email, fingerprint, apiKeyId: apiKey });

    await logUsageAsync(apiKey, fingerprint, "success");

    return res
        .status(200)
        .json(new APIResponse(200, { sessionId }, "Session registered successfully"));
});


const logout = asyncHandler(async (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId) {
        throw new APIError(400, "Session ID is required");
    }
    if(!await redis.get(`session:${sessionId}`))
    {
        return res.
         status(403).
         send(new APIError(403,"Session Id doesnot exists"))
    }
    await redis.del(`session:${sessionId}`);

    return res
        .status(200)
        .json(new APIResponse(200, {}, "Logged out successfully"));
});

const handleLoginFailure = asyncHandler(async (req, res) => {
    const { fingerprint, accountIdentifier, apiKey } = req.body;

    if (!accountIdentifier && !fingerprint) {
        throw new APIError(400, "At least accountIdentifier or fingerprint is required");
    }

    const scope = req.apiKeyHash || "anon";
    const rule = await loadSecurityRule(req.projectId);
    const otpLimit = rule.otpLimit;

    // 1. Account Counter (HMAC normalized identity)
    let accAttempts = 0;
    if (accountIdentifier) {
        const normalized = accountIdentifier.toString().trim().toLowerCase();
        const secret = process.env.HMAC_SECRET || "secureflow-fallback-secret";
        const stableAccountId = crypto.createHmac("sha256", secret).update(normalized).digest("hex");
        
        const accKey = `fail:acc:${scope}:${stableAccountId}`;
        accAttempts = await redis.incr(accKey);
        if (accAttempts === 1) await redis.expire(accKey, 86400);
    }

    // 2. Device Counter (Graceful fallback if fingerprint is missing)
    let fpAttempts = 0;
    if (fingerprint) {
        const fpKey = `fail:fp:${scope}:${fingerprint}`;
        fpAttempts = await redis.incr(fpKey);
        if (fpAttempts === 1) await redis.expire(fpKey, 86400);
    }

    const locked = (accAttempts > otpLimit) || (fpAttempts > otpLimit);

    if (locked) {
        await logUsageAsync(apiKey, fingerprint, "failed");
        return res.status(423).json(
            new APIResponse(
                423,
                { isLocked: true, accAttempts, fpAttempts, reason: "Too many failed attempts" },
                "Security Alert: This account or device is currently locked."
            )
        );
    }

    await logUsageAsync(apiKey, fingerprint, "success");

    return res.status(401).json(
        new APIResponse(
            401,
            { isLocked: false, attemptsLeft: Math.max(0, otpLimit - Math.max(accAttempts, fpAttempts)) },
            "Invalid login attempt."
        )
    );
});



const validateAndProcessRequest = asyncHandler(async (req, res) => {
    const { sessionId, fingerprint } = req.body;

    // apiKeyId is the server-trusted MongoDB ObjectId resolved by checkuserlimit
    // from the x-api-key header. Use it for all usage logging so events are
    // always recorded even when sessionId/fingerprint are absent (e.g. Postman,
    // direct API integrations that haven't registered a session yet).
    const apiKeyMeta = { apiKeyId: req.apiKeyId || null, ip: req.ip };

    // Session validation is optional for direct API calls. If sessionId is
    // present, enforce fingerprint binding; if absent, skip session check and
    // allow the request (the decision middleware has already scored it).
    if (sessionId) {
        if (!fingerprint) {
            await logUsageAsync(null, null, "failed",
                "sessionId supplied but fingerprint missing.", apiKeyMeta);
            return res.status(401).json(
                new APIResponse(401, null, "Fingerprint required when sessionId is provided")
            );
        }

        const storedFingerprint = await redis.get(`session:${sessionId}`);

        if (!storedFingerprint) {
            await logUsageAsync(null, fingerprint, "failed", "Session expired.", apiKeyMeta);
            return res.status(401).json(new APIResponse(401, null, "Session expired"));
        }

        if (storedFingerprint !== fingerprint) {
            await logUsageAsync(null, fingerprint, "session-theft",
                "Device fingerprint does not match the stored session fingerprint.", apiKeyMeta);
            return res.status(403).json(new APIResponse(403, null, "Fingerprint mismatch"));
        }
    }

    // Rate limiting is handled upstream by `enforceRateLimit` middleware.
    await logUsageAsync(null, fingerprint || null, "success", "", apiKeyMeta);

    return res.status(200).json(
        new APIResponse(200, { access: "granted" }, "Request processed")
    );
});

export {
    registerLoginSuccess,
    logout,
    handleLoginFailure,
    validateAndProcessRequest
}


// const bondingSessionAndFingerprint = asyncHandler( async (req,res,next) =>{
//     const {apiKey,sessionId,fingerPrint} = req.body()
    
//     if(!apiKey || !sessionId || !fingerPrint)
//     {
//         return res
//         .status(401)
//         .json(
//             new APIResponse(401,{},"All fields are required")
//         ) 
//     }
//     const api = ApiKey.find({
//         key : apiKey
//     })
//     if(!api)
//     {
//         throw new APIError(401,"Invalid api key")
//     }

//     const result = await redis.set(`${api.projectId}:${sessionId}`,`${fingerPrint}`,{
//   EX: 300   
// })

// if(result)
// {
//     throw new APIError(501,"An Error occured while storing in redis")
// }

//     return res
//     .status(201)
//     .json(
//         new APIResponse(201,{},"SessionId and FingerPrint registerd Successfully")
//     )
// }
// )

// const unbondingSessionAndFingerprint = asyncHandler( async(req,res,next)=>{
//     const {apiKey,sessionId,fingerPrint} = req.body()
    
//     if(!apiKey || !sessionId || !fingerPrint)
//     {
//         throw new APIError(401,"All fields are required")
//     }
//     const api = ApiKey.find({
//         key : apiKey
//     })
//     if(!api)
//     {
//         throw new APIError(401,"Invalid api key")
//     }

//     const result = await redis.set(`${api.projectId}:${sessionId}`,`${fingerPrint}`,{
//   EX: 300   
// })

// if(result)
// {
//     throw new APIError(501,"An Error occured while storing in redis")
// }

//     return res
//     .status(201)
//     .json(
//         new APIResponse(201,{},"SessionId and FingerPrint registerd Successfully")
//     )
// })