import { Router } from "express"

import {creatNewAPIKey} from "../controllers/api.controller.js"
import { verifyJWT } from "../middleware/auth.middleware.js"

const router = Router()

router.route("/create-new-apikey").post(verifyJWT, creatNewAPIKey)

export default router
