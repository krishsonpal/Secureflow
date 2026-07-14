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
    const { fingerprint, apiKey } = req.body;

    if (!fingerprint) {
        throw new APIError(400, "Fingerprint is required");
    }

    // Scope the lockout to SERVER-TRUSTED dimensions. The old `fail:fp:<fingerprint>`
    // key was entirely client-supplied: an attacker rotated the fingerprint to dodge
    // the lock, or forged someone else's to lock them out. We now bucket by the
    // resolved apiKey hash + observed IP, and additionally cap per-IP so
    // fingerprint-rotation from one origin still trips a lock.
    const scope = req.apiKeyHash || "anon";
    const ip = req.ip || "unknown";
    const rule = await loadSecurityRule(req.projectId);
    const fpLimit = rule.otpLimit;            // per device fingerprint
    const ipLimit = rule.otpLimit * 5;        // coarser per-IP ceiling

    const fpKey = `fail:fp:${scope}:${fingerprint}`;
    const ipKey = `fail:ip:${scope}:${ip}`;

    const [fpAttempts, ipAttempts] = await Promise.all([
        redis.incr(fpKey),
        redis.incr(ipKey),
    ]);
    if (fpAttempts === 1) await redis.expire(fpKey, 86400);
    if (ipAttempts === 1) await redis.expire(ipKey, 86400);

    const locked = fpAttempts > fpLimit || ipAttempts > ipLimit;

    if (locked) {
        await logUsageAsync(apiKey, fingerprint, "failed");
        return res.status(423).json(
            new APIResponse(
                423,
                { isLocked: true, attempts: fpAttempts, reason: "Too many failed attempts" },
                "Security Alert: This device is currently locked."
            )
        );
    }

    await logUsageAsync(apiKey, fingerprint, "success");

    return res.status(401).json(
        new APIResponse(
            401,
            { isLocked: false, attemptsLeft: Math.max(0, fpLimit - fpAttempts) },
            "Invalid login attempt."
        )
    );
});



const validateAndProcessRequest = asyncHandler(async (req, res) => {
    const { sessionId, fingerprint, apiKey } = req.body;

    if (!sessionId || !fingerprint) {

        await logUsageAsync(apiKey, fingerprint, "failed", "Session credentials or fingerprint missing from request.");
        return res.status(401).json(
            new APIResponse(401, null, "Session credentials missing")
        );
    }

    const storedFingerprint = await redis.get(`session:${sessionId}`);

    if (!storedFingerprint) {
        await logUsageAsync(apiKey, fingerprint, "failed");
        return res.status(401).json(new APIResponse(401, null, "Session expired"));
    }

    if (storedFingerprint !== fingerprint) {
        await logUsageAsync(apiKey, fingerprint, "session-theft", "Device fingerprint does not match the stored session fingerprint.");
        return res.status(403).json(new APIResponse(403, null, "Fingerprint mismatch"));
    }

    // Rate limiting moved to `enforceRateLimit` middleware (Part 1.6): it keys on
    // the server-trusted apiKey hash + client IP (not the client-supplied
    // sessionId, which the old inline limiter used and which rotating sessionIds
    // trivially bypassed) and pulls the limit from the project's SecurityRule.

    // Success - Log usage and return data
    await logUsageAsync(apiKey, fingerprint, "success");

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