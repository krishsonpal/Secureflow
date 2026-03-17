import dotenv from "dotenv"
import connectDB from "./db/index.js"
import {app} from "./app.js"
import http from "http"
import { initSocket } from "./socket.js"

dotenv.config({
    path: "./.env"
})

connectDB().then(
    () =>{
        const server = http.createServer(app);
        initSocket(server);
        
        server.listen(process.env.PORT || 3000,() =>
            console.log("connection made successfully on port", process.env.PORT || 3000)
        )
    }
).catch(
    (err) =>{
        console.log("An error has occured")
    }
)

