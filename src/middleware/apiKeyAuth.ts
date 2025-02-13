import { Request, Response, NextFunction } from "express";
import { validateApiKey } from "../utils/apiKey";

export async function authenticateApiKey(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const apiKey = req.header("X-API-Key");

    if (!apiKey) {
        return res.status(401).json({ error: "API key is required" });
    }

    const isValid = await validateApiKey(apiKey);

    if (!isValid) {
        return res.status(401).json({ error: "Invalid or expired API key" });
    }

    next();
}

// Rate limiting middleware per API key
export function apiKeyRateLimit(requestsPerMinute: number = 60) {
    const requests = new Map<string, number[]>();

    return async (req: Request, res: Response, next: NextFunction) => {
        const apiKey = req.header("X-API-Key");
        if (!apiKey) return next();

        const now = Date.now();
        const minute = 60 * 1000;

        if (!requests.has(apiKey)) {
            requests.set(apiKey, [now]);
            return next();
        }

        const keyRequests = requests.get(apiKey)!;
        const recentRequests = keyRequests.filter(
            (time) => now - time < minute
        );

        if (recentRequests.length >= requestsPerMinute) {
            return res.status(429).json({
                error: "Too many requests",
                retryAfter: Math.ceil(
                    (recentRequests[0] + minute - now) / 1000
                ),
            });
        }

        recentRequests.push(now);
        requests.set(apiKey, recentRequests);

        next();
    };
}
