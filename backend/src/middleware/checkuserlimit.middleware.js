import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { redis } from "../app.js"
import { ApiKey } from "../models/apikey.model.js";


const getApiKeyFromDB = async(req,res,next) =>{
    const apiKey = req.headers['x-api-key'].trim()
    const DbApiKey = await ApiKey.findOne({
        key : apiKey
    })
    return DbApiKey
}

const checkuserlimit = asyncHandler( async(req,res,next) =>{
    const apiKey = req.headers['x-api-key']

    if(!apiKey)
    {
        return res
        .status(401)
        .json(
            new APIResponse(401,{},"Missing API Key")
        )
    }

    var redisApiData = await redis.get(apiKey)

    if(!redisApiData)
    {
           const DbApiKey = await getApiKeyFromDB(req)
           if(!DbApiKey)
           {
            return res.
            status(401)
            .json(
                new APIResponse(401,{},"Invalid Api key")
            )
           }
           console.log(DbApiKey.key)
           await redis.set(DbApiKey.key, DbApiKey.credits)
           redisApiData = await redis.get(apiKey)
           
    }
    
    if(redisApiData <= 0)
    {
        return res
        .status(402)
        .json(
            new APIResponse(402,{},"Credits Are finished")
        )
    }
    next()
})

export { checkuserlimit }