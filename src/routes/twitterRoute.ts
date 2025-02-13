import { Router, Request, Response, RequestHandler } from "express";
import { Scraper } from "agent-twitter-client";

const router = Router();
const scraper = new Scraper();

interface ScrapingResponse {
    username: string;
    tweets: any[];
    success: boolean;
    message?: string;
}

interface ScrapingRequest {
    username: string;
}

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

router.post("/scrape", scrapeTweets);

export { scraper };
export default router;
