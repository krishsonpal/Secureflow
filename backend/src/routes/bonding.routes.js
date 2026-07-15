import { Router } from "express"

import { checkuserlimit } from "../middleware/checkuserlimit.middleware.js"
import { enforceRateLimit } from "../middleware/rateLimit.middleware.js"
import { decisionMiddleware } from "../middleware/decision.middleware.js"

import {
    registerLoginSuccess,
    logout,
    handleLoginFailure,
    validateAndProcessRequest
} from "../controllers/bonding.controller.js"

import { checkXSS } from "../middleware/xsscheck.middleware.js"

const router = Router()

// Hot path (Phase 2.1): detectors (checkXSS, ...) EMIT signals onto req.signals
// instead of blocking; identity is resolved (checkuserlimit) and coarse quotas
// applied (enforceRateLimit); then decisionMiddleware fuses the signals via the
// scoring engine and enforces the graduated action just before the controller.
//
// enforceRateLimit runs AFTER checkuserlimit so it can key on the resolved,
// server-trusted apiKey hash + IP (not client-supplied sessionId/fingerprint).
router.route("/register-user").post(checkXSS,checkuserlimit,enforceRateLimit,decisionMiddleware,registerLoginSuccess)

router.route("/logout").post(checkuserlimit,logout)

router.route("/login-failure").post(checkuserlimit,handleLoginFailure)

router.route("/validation").post(checkXSS,checkuserlimit,enforceRateLimit,decisionMiddleware,validateAndProcessRequest)

export default router