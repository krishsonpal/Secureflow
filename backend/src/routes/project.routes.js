import { Router } from "express"

import {
    createNewProject,
    deleteProject,
    getMyProjects,
    getProjectAnalytics
} from "../controllers/project.controller.js"

const router = Router()

router.route("/create-project").post(createNewProject)
router.route("/my-projects").get(getMyProjects)
router.route("/:projectId/analytics").get(getProjectAnalytics)

export default router