import { Router } from "express"

import { checkuserlimit } from "../middleware/checkuserlimit.middleware.js"

import {
    registerLoginSuccess,
    logout,
    handleLoginFailure,
    validateAndProcessRequest
} from "../controllers/bonding.controller.js"

import { checkXSS } from "../middleware/xsscheck.middleware.js"

const router = Router()

router.route("/register-user").post(checkXSS,checkuserlimit,registerLoginSuccess)

router.route("/logout").post(checkuserlimit,logout)

router.route("/login-failure").post(checkuserlimit,handleLoginFailure)

router.route("/validation").post(checkXSS,checkuserlimit,validateAndProcessRequest)

export default router