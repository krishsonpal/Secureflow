import { asyncHandler } from "../utils/asyncHandler.js"
import { APIError } from "../utils/apierror.js"
import { resolveUserFromToken } from "../utils/verifyAccessToken.js"

// Shared authentication middleware. Replaces the inline `jwt.verify(...)` that
// each protected controller used to re-implement (and which left `req.user`
// unpopulated). Verifies the access token and attaches the user to `req.user`.
// Token verification is delegated to the shared resolver so the HTTP path and the
// Socket.io handshake authenticate identically (Part 1.7).
export const verifyJWT = asyncHandler(async (req, res, next) => {
    const token =
        req.cookies?.accessToken ||
        req.headers.authorization?.replace(/^Bearer\s+/i, "").trim()

    try {
        req.user = await resolveUserFromToken(token)
    } catch (err) {
        throw new APIError(401, `Unauthorized: ${err.message}`)
    }

    next()
})

// Basic RBAC guard. Use after verifyJWT: e.g. requireRole("admin").
// With no roles passed it just asserts an authenticated user.
export const requireRole = (...roles) =>
    asyncHandler(async (req, res, next) => {
        if (!req.user) {
            throw new APIError(401, "Unauthorized")
        }
        if (roles.length && !roles.includes(req.user.role)) {
            throw new APIError(403, "Forbidden: insufficient role")
        }
        next()
    })
