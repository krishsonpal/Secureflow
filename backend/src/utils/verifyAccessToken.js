import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";

/**
 * Verify an access token and load the owning user (minus secrets).
 *
 * Single source of truth for "who is this token", shared by the HTTP `verifyJWT`
 * middleware and the Socket.io handshake so both authenticate identically. Throws
 * a plain Error on any failure; callers map it to their transport (APIError for
 * HTTP, next(err) for the socket middleware).
 *
 * @param {string} token  Raw JWT (any "Bearer " prefix is stripped by the caller).
 * @returns {Promise<import("mongoose").Document>} the user document
 */
export const resolveUserFromToken = async (token) => {
    if (!token) throw new Error("access token missing");

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    } catch {
        throw new Error("invalid or expired access token");
    }

    const user = await User.findById(decoded?._id).select("-password -refreshToken");
    if (!user) throw new Error("user no longer exists");

    return user;
};
