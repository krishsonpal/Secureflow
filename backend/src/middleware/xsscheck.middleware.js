import axios from "axios";
import { logUsageAsync } from "../utils/logusage.js";

export const checkXSS = async (req, res, next) => {
    try {

        const  input  = req.body.requestdata;
        console.log(input)

        const response = await axios.post(
            process.env.MICROSERVICE_URI,
            { content: input }
        );

        if (response.data.prediction === 1) {
            const { apiKey, fingerprint } = req.body;
            if (apiKey && fingerprint) {
                await logUsageAsync(apiKey, fingerprint, "xss", "Malicious payload detected by AI model");
            }
            return res.status(403).json({
                message: "XSS Detected",
                details: response.data
            });
        }

        next(); // continue to next middleware/controller

    } catch (error) {
        return res.status(500).json({
            error: "ML service error"
        });
    }
};