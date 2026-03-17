import mongoose  from "mongoose";

const connectDB = async () => {
    try{
        const connectionIntance = await mongoose.connect(`${process.env.MONGODB_URI}${process.env.DB_NAME}`)
        // console.log(connectionIntance)
    }
    catch(error){
        console.log(`An error occured,while connecting to database : \n${error} `)
        process.exit(1)
    }
}

export default connectDB