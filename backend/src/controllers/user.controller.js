import { APIResponse } from "../utils/apiresponse.js";
import { APIError } from "../utils/apierror.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";

import jwt from "jsonwebtoken"
import mongoose from "mongoose";
import { generateOtp } from "../utils/generateOtp.js";
import { sendEmail } from "../utils/sendEmail.js";


const generateAccessAndRefreshToken = async (userId) => {
    try{
        const user = await User.findById(userId)
        const accessToken = await user.generateAccessToken()
        const refreshToken = await user.generateRefreshToken()

        user.refreshToken = refreshToken
        await user.save({validateBeforeSave : false})

        return { accessToken , refreshToken }
    }
    catch(error)
    {
        throw new APIError(500,"Something went wrong will generating access and refresh token")
    }
}

const generateAccessToken = async (userId) => {
    try{
        const user = await User.findById(userId)
        const accessToken = await user.generateAccessToken()
        return { accessToken }
    }
    catch(error)
    {
        throw new APIError(500,"Something went wrong will generating access and refresh token")
    }
}

const registerUser = asyncHandler(async (req,res,next) =>
{
    const {username, email, password} = req.body

    if([username,email,password].some((field) => field?.trim() === ""))
    {
        throw new APIError(400, "All fields are required!")
    }

    const existedUser = await User.findOne({
        $or : [{username},{email}]
    })

    if(existedUser)
    {
        throw new APIError(409, "User alreday exists")
    }

    const user  = await  User.create({
        username,
        email,
        password
    })

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if(!createdUser){
        throw new APIError(500, "Something went wrong will creating user")
    }
    return res.status(201).json(
        new APIResponse(201,createdUser,"User registered successfully")
    )
})

const loginUser = asyncHandler( async(req,res,next)  =>{
    const {username,email,password} = req.body

    if(!username && !email)
    {
        throw new APIError(400,"username or email is required")
    }
     
    const user = await User.findOne({
        $or : [{username},{email}]
    })

    if(!user)
    {
        throw new APIError(404,"User doesnot exists")
    }

    const isPasswordValid = await user.isPasswordCorrect(password)

    if(!isPasswordValid)
    {
        throw new APIError(401,"Invalid user credentials")
    }

    const {accessToken,refreshToken} = await generateAccessAndRefreshToken(user._id)

    const loggedUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    const options = {
        httpOnly : true,
        secure : true,
        sameSite : "none"
    }
    console.log(accessToken)
    return res
    .status(200)
    .cookie("accessToken",accessToken,options)
    .cookie("refreshToken",refreshToken,options)
    .json(
        new APIResponse(200,
            {
                user : loggedUser,
                accessToken : accessToken,
                refreshToken : refreshToken
            },
            "User logged in successfully"
        )
    )
})

const logoutUser = asyncHandler( async(req,res,next)=>{
    const accessToken = req.cookies.accessToken || req.headers.authorization?.split(" ")[1];
    
    if(accessToken) {
        try {
            const decodedToken = jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET);
            await User.findByIdAndUpdate(
                decodedToken._id,
                {
                    $unset:{
                        refreshToken:1
                    }
                },
                {
                    new : true
                }
            )
        } catch(error) {
            // Token might be expired, proceed to clear cookies
        }
    }

    const options = {
        httpOnly : true,
        secure :  true,
        sameSite : "none"
    }

    return res
    .status(200)
    .clearCookie("accessToken",options)
    .clearCookie("refreshToken",options)
    .json(
        new APIResponse(200,
            {},
            "User loggedout successfully"
        )
    )
}
)

const refreshToken = asyncHandler( async (req,res,next) =>{
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if(!incomingRefreshToken){
        throw new APIError(400,"RefreshToken is missing")
    }

    try{
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        )
        const user = await User.findById(decodedToken?._id)
        if(!user)
        {
            throw new APIError(401,"Invalid refresh token")
        }

        if(incomingRefreshToken !== user?.refreshToken)
        {
            throw new APIError(401,"Refresh token is expired or used")
        }

        const options = {
            httpOnly : true,
            secure : true,
            sameSite : "none"
        }
        const { accessToken} = await generateAccessToken(user._id)
        const loggedUser = await User.findById(user._id).select("-password -refreshToken")

        return res
        .status(200)
        .cookie("accessToken",accessToken,options)
        .json(
            new APIResponse(201,
                {
                user : loggedUser,accessToken
            },
            "New access token granted successfully"
            )
        )
    }
    catch(error){
        throw new APIError(401,error?.message || "Invalid refresh token"
        )
    }
    
}

)

const otpGeneration = asyncHandler( async(req,res,next) =>{
    const {username,email} = req.body

    if(!email && !username)
    {
        throw new APIError(401, "Email is required")
    }

    const user = await User.findOne({
        $or : [{username},{email}]
    })

    if(!user)
    {
        throw new APIError(401,"User does not exists")
    }

    const otp = generateOtp()
    //store in otp in redis
    try{
        await sendEmail(user.email,otp)
    }
    catch(error)
    {
        throw new APIError(501,"An error occured while sending email")
    }
    return res
    .status(201)
    .json(
        new APIResponse(201,{},"Otp sent successfully")
    )

})

const matchOtp = asyncHandler((req,res,next) =>{
    const recievedOtp = req.body.recievedOtp

    if(!recievedOtp)
    {
        throw new APIError(401,"Otp is required")
    }

    // const Otp
    //take otp from redis

    if(recievedOtp !== Otp)
    {
        throw new APIError(401,"Otp doesnot match")
    }

    return res
    .status(201)
    .json(
        new APIResponse(200,{},"Otp match successfully")
    )
}
)

const setNewPassword = asyncHandler( async (req,res,next) =>{
    const {newPassword} = req.body
    
    if(!newPassword) {
        throw new APIError(400, "New password is required")
    }
    
    const user = req.user
    user.password = newPassword
    await user.save({validateBeforeSave: false})
    
    return res.status(200).json(
        new APIResponse(200, {}, "Password changed successfully")
    )
})


const getCurrentUser = asyncHandler( async (req,res,next)=>{
    return res.status(200).json(
        new APIResponse(200, req.user, "Current user fetched successfully")
    )
})

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshToken,
    otpGeneration,
    matchOtp,
    setNewPassword,
    getCurrentUser
}

