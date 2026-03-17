import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import crypto from 'crypto';
import jwt from "jsonwebtoken"
import { Project } from "../models/project.model.js";
import { ApiKey } from "../models/apikey.model.js";


const createApiKey = (req,res,next)=>{
    return crypto.randomBytes(32).toString('hex');
}


const creatNewAPIKey = asyncHandler( async(req,res,next) =>{
    const accessToken = req.cookies.accessToken || req.headers.authorization?.split(" ")[1];
    const {projectId} = req.body

        if(!accessToken){
                throw new APIError(400,"AccessToken is missing")
            }
        
            try{
                const decodedToken = jwt.verify(
                    accessToken,
                    process.env.ACCESS_TOKEN_SECRET
                )
                const foundproject = await Project.findById(projectId)

                if(!foundproject)
                {
                    throw new APIError(401,"Project doesnot exists")
                }

                if(foundproject.userId.toString() !== decodedToken?._id)
                {
                    throw new APIError(401,"Project userid doesnot match with the token userid")
                }
                
                const hashCode=  createApiKey()

                if(!hashCode)
                {
                    throw new APIError(501,"An error occured while createing api key")
                }

                const apiKey= await ApiKey.create({
                    key : hashCode,
                    userId : foundproject.userId,
                    projectId : foundproject._id,
                    lastUsedAt : new Date()
                })    
    
                const createdAPI = await ApiKey.findById(apiKey._id).select(
                        "-userId"
                    )
                if(!createdAPI){
                        throw new APIError(500, "Something went wrong will creating APIKey")
                }
                return res
                .status(201)
                .json(
                    new APIResponse(201,createdAPI,"New APIKey Created Successfully")
                )
    
            }
            catch(error){
            throw new APIError(401,error?.message || "Something went wrong")
            }
})

export {
    creatNewAPIKey
}


