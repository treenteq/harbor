import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export function generateApiKey(): string {
    // Format: prefix_timestamp_random
    const prefix = "pk";
    const timestamp = Date.now().toString(36);
    const randomBytes = crypto.randomBytes(16).toString("hex");
    return `${prefix}_${timestamp}_${randomBytes}`;
}

// Hash an API key for storage
export async function hashApiKey(apiKey: string): Promise<string> {
    return crypto.createHash("sha256").update(apiKey).digest("hex");
}

// Validate an API key
export async function validateApiKey(apiKey: string): Promise<boolean> {
    try {
        const hashedKey = await hashApiKey(apiKey);
        const key = await prisma.apiKey.findFirst({
            where: {
                key: hashedKey,
                isActive: true,
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
        });

        if (key) {
            // Update last used timestamp
            await prisma.apiKey.update({
                where: { id: key.id },
                data: { lastUsed: new Date() },
            });

            // Log usage
            await prisma.apiKeyUsage.create({
                data: {
                    apiKey: hashedKey,
                    endpoint: "request.path", // You'll need to pass this from middleware
                    method: "request.method", // You'll need to pass this from middleware
                    status: 200, // You'll need to pass this from middleware
                    ip: "request.ip", // You'll need to pass this from middleware
                },
            });

            return true;
        }

        return false;
    } catch (error) {
        return false;
    }
}
