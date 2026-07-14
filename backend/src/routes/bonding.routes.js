import { Router } from "express"

import { checkuserlimit } from "../middleware/checkuserlimit.middleware.js"
import { enforceRateLimit } from "../middleware/rateLimit.middleware.js"

import {
    registerLoginSuccess,
    logout,
    handleLoginFailure,
    validateAndProcessRequest
} from "../controllers/bonding.controller.js"

import { checkXSS } from "../middleware/xsscheck.middleware.js"

const router = Router()

// enforceRateLimit runs AFTER checkuserlimit so it can key on the resolved,
// server-trusted apiKey hash + IP (not client-supplied sessionId/fingerprint).
router.route("/register-user").post(checkXSS,checkuserlimit,enforceRateLimit,registerLoginSuccess)

router.route("/logout").post(checkuserlimit,logout)

router.route("/login-failure").post(checkuserlimit,handleLoginFailure)

router.route("/validation").post(checkXSS,checkuserlimit,enforceRateLimit,validateAndProcessRequest)

export default router