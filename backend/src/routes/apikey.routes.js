import { Router } from "express"

import {creatNewAPIKey} from "../controllers/api.controller.js"
import { verifyJWT } from "../middleware/auth.middleware.js"
import { authorize } from "../middleware/authorize.js"

const router = Router()

// authorize resolves the project (from body.projectId) into req.tenant and
// checks apikey:create in that org.
router.route("/create-new-apikey").post(verifyJWT, authorize("apikey", "create"), creatNewAPIKey)

export default router
