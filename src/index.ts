import express, { Request, Response, RequestHandler } from "express";
import { Scraper } from "agent-twitter-client";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();

const apiRoute = "/v1";
const port = process.env.PORT || 3000;

const scraper = new Scraper();

// CORS configuration
const corsOptions = {
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(express.json());

interface ScrapingResponse {
    username: string;
    tweets: any[];
    success: boolean;
    message?: string;
}

interface ScrapingRequest {
    username: string;
}

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

const healthCheck: RequestHandler = (_req, res) => {
    res.status(200).json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development",
    });
};

const scrapeTweets: RequestHandler<
    {},
    ScrapingResponse,
    ScrapingRequest
> = async (req, res) => {
    const { username } = req.body;

    if (!username) {
        res.status(400).json({
            username: "",
            tweets: [],
            success: false,
            message: "Username is required",
        });
        return;
    }

    try {
        const tweets: any[] = [];
        const tweetGenerator = scraper.getTweetsAndReplies(username);

        for await (const tweet of tweetGenerator) {
            tweets.push(tweet);
        }

        const response: ScrapingResponse = {
            username,
            tweets,
            success: true,
        };

        res.status(200).json(response);
    } catch (error) {
        console.error(`Error scraping tweets for ${username}:`, error);

        const response: ScrapingResponse = {
            username,
            tweets: [],
            success: false,
            message:
                error instanceof Error
                    ? error.message
                    : "An unknown error occurred",
        };

        res.status(500).json(response);
    }
};

app.get("/", healthCheck);
app.get(`${apiRoute}/health`, healthCheck);
app.post(`${apiRoute}/scrape`, scrapeTweets);

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
