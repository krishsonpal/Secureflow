import { Router } from "express"

import {creatNewAPIKey} from "../controllers/api.controller.js"

const router = Router()

router.route("/create-new-apikey").post(creatNewAPIKey)

export default router