import { Router } from "express"

import {
    registerUser,
    loginUser,
    logoutUser,
    refreshToken,
    otpGeneration,
    matchOtp,
    setNewPassword,
    getCurrentUser
} from "../controllers/user.controller.js"



const router = Router()

router.route("/register").post(registerUser)

router.route("/login").post(loginUser)

router.route("/logout").post(logoutUser)

router.route("/refresh-token").post(refreshToken)

// router.route("/get-current-user").get(getCurrentUser)



export default router