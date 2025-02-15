import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import twitterRouter, { scraper } from "./routes/twitterRoute";
import dataRouter from "./routes/dataRoute";
import apiKeyRouter from "./routes/apiKeyRoute";

dotenv.config();

const app = express();
const apiRoute = "/v1";
const port = process.env.PORT || 3000;

// CORS configuration
const corsOptions = {
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(express.json());

// Health check endpoint
app.get("/", (_req, res) => {
    res.status(200).json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development",
    });
});

app.get(`${apiRoute}/health`, (_req, res) => {
    res.status(200).json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development",
    });
});

// Routes
app.use(`${apiRoute}/twitter`, twitterRouter);
app.use(`${apiRoute}/data`, dataRouter);
app.use(`${apiRoute}/api-keys`, apiKeyRouter);

function validateEnv(): void {
    const requiredEnvVars = {
        TWITTER_USERNAME: process.env.TWITTER_USERNAME,
        TWITTER_PASSWORD: process.env.TWITTER_PASSWORD,
        TWITTER_EMAIL: process.env.TWITTER_EMAIL,
    };

    const missingVars = Object.entries(requiredEnvVars)
        .filter(([_, value]) => !value)
        .map(([key]) => key);

    if (missingVars.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missingVars.join(
                ", "
            )}\n` +
                "Please check your .env file and ensure all required variables are set."
        );
    }
}

async function initializeTwitter() {
    try {
        validateEnv();
        await scraper.login(
            process.env.TWITTER_USERNAME!,
            process.env.TWITTER_PASSWORD!,
            process.env.TWITTER_EMAIL!
        );
        console.log("Successfully logged into Twitter");
    } catch (error) {
        console.error("Failed to initialize Twitter:", error);
        process.exit(1);
    }
}

const startServer = async () => {
    try {
        await initializeTwitter();
        app.listen(port, () => {
            console.log(`Server is running on port ${port}`);
            console.log(
                `Environment: ${process.env.NODE_ENV || "development"}`
            );
        });
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
};

startServer();
