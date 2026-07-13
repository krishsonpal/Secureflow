import { Router } from "express"

import {
    createNewProject,
    deleteProject,
    getMyProjects,
    getProjectAnalytics
} from "../controllers/project.controller.js"
import { verifyJWT } from "../middleware/auth.middleware.js"

const router = Router()

// All project routes require an authenticated dashboard user.
router.use(verifyJWT)

router.route("/create-project").post(createNewProject)
router.route("/delete-project").delete(deleteProject)
router.route("/my-projects").get(getMyProjects)
router.route("/:projectId/analytics").get(getProjectAnalytics)

export default router
