import mongoose , {mongo, Schema} from "mongoose"
import jwt from "jsonwebtoken"
import bcrypt from "bcrypt"

const userSchema = new Schema(
    {
        username : {
            type: String,
            required : [true, "Username is required"],
            unique : true,
            lowercase : true,
            trim : true,
            index : true,
        },
        email : {
            type : String,
            unique : true,
            required : [true, "Email is required"],
            lowercase : true,
            trim : true,
        },
        password : {
            type : String,
            required : [true, "Password is required"]
        },
        refreshToken :{
            type : String
        },
        balance : {
            type : Number,
            default : 10
        }
        // role : {
        //     type : String,
        //     enum : ["DEVELOPER","ADMIN"],
        //     default : "ADMIN"
        // },
        // isVerified :{
        //     type : Boolean,
        //     default 
        // }
    },{
        timestamps : true
    }
)

userSchema.pre("save", async function(next) {
    if(!this.isModified("password")) return;

    this.password = await bcrypt.hash(this.password,10);
})

userSchema.methods.isPasswordCorrect = async function(password){
    return await bcrypt.compare(password,this.password)
}

userSchema.methods.generateAccessToken = async function(){
    return jwt.sign({
        _id : this.id,
        email : this.email,
        username : this.username
    },
    process.env.ACCESS_TOKEN_SECRET,
    {
        expiresIn : process.env.ACCESS_TOKEN_EXPIRY
    }
    )
}

userSchema.methods.generateRefreshToken = async function(){
    return jwt.sign({
        _id : this.id,
    },
    process.env.REFRESH_TOKEN_SECRET,
    {
        expiresIn : process.env.REFRESH_TOKEN_EXPIRY
    }
    )
}

export const User = mongoose.model("User",userSchema)