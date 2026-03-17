import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import Redis from 'ioredis'



const app = express()



const redis = new Redis(process.env.REDIS_URL || undefined)

app.use(cors({
  origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : [
    "http://localhost:5173",
    "http://localhost:4000"
  ],
  credentials: true
}));
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
// app.use(express.static())
app.use(cookieParser())

app.use((err, req, res, next) => {
    const statusCode = err.statuscode || 500;
    const message = err.message || "Internal Server Error";

    return res.status(statusCode).json({
        success: false,
        statuscode: statusCode,
        message: message,
        errors: err.errors || [],
        data: null
    });
});


import userRouter from "./routes/user.routes.js"
import projectRouter from "./routes/project.routes.js"
import apirouter from "./routes/apikey.routes.js"
import servicerouter from "./routes/bonding.routes.js"

app.use("/api/v1/users", userRouter)
app.use("/api/v1/projects",projectRouter)
app.use("/api/v1/apikey",apirouter)
app.use("/api/v1/service",servicerouter)


export { app ,redis }