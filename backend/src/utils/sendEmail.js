import nodemailer from "nodemailer"
import { APIError } from "./apierror.js"

const sendEmail = async (email, message) => {
    try {

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            },
            tls: {
                rejectUnauthorized: false
            }
        })

        await transporter.sendMail({
            from: process.env.SMTP_FROM,
            to: email,
            subject: "Important",
            text: message
        })

        return { success: true, message: "Email sent successfully" }

    } catch (error) {
        throw new APIError(500, "Failed to send email: " + error.message)
    }
}

export { sendEmail }