import jwt from "jsonwebtoken"
import { asyncHandler } from "../utils/asyncHandler.js"
import { APIError } from "../utils/apierror.js"
import { User } from "../models/user.model.js"

// Shared authentication middleware. Replaces the inline `jwt.verify(...)` that
// each protected controller used to re-implement (and which left `req.user`
// unpopulated). Verifies the access token and attaches the user to `req.user`.
export const verifyJWT = asyncHandler(async (req, res, next) => {
    const token =
        req.cookies?.accessToken ||
        req.headers.authorization?.replace(/^Bearer\s+/i, "").trim()

    if (!token) {
        throw new APIError(401, "Unauthorized: access token missing")
    }

    let decoded
    try {
        decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
    } catch {
        throw new APIError(401, "Unauthorized: invalid or expired access token")
    }

    const user = await User.findById(decoded?._id).select("-password -refreshToken")
    if (!user) {
        throw new APIError(401, "Unauthorized: user no longer exists")
    }

    req.user = user
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
