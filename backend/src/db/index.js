import mongoose from "mongoose";

// Log post-connection blips instead of letting them surface as unhandled
// errors. Mongoose auto-reconnects, so a momentary hiccup should not be fatal.
mongoose.connection.on("error", (err) => {
    console.error("[mongo] connection error:", err?.message || err)
})
mongoose.connection.on("disconnected", () => {
    console.warn("[mongo] disconnected — mongoose will attempt to reconnect")
})

const connectDB = async () => {
    const uri = `${process.env.MONGODB_URI}${process.env.DB_NAME}`
    const maxAttempts = 5

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 })
            console.log("[mongo] connected")
            return
        } catch (error) {
            console.error(`[mongo] connect attempt ${attempt}/${maxAttempts} failed: ${error?.message || error}`)
            if (attempt === maxAttempts) {
                // Give up after retries — let the caller decide how to handle a
                // hard boot failure (index.js logs and exits).
                throw error
            }
            await new Promise((r) => setTimeout(r, 2000 * attempt))
        }
    }
}

export default connectDB
