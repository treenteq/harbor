import express, { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { generateEthereumKeyPair, encryptData } from "../utils/crypto";

const router = express.Router();
const prisma = new PrismaClient();

declare global {
    namespace Express {
        interface Request {
            userId?: string;
        }
    }
}

const authenticateUser = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "No token provided" });
        return;
    }

    const userId = authHeader.replace("Bearer ", "");

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            res.status(401).json({ error: "User not found" });
            return;
        }

        req.userId = userId;
        next();
    } catch (error) {
        res.status(401).json({ error: "Authentication failed" });
        return;
    }
};

const createKeyLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 5,
});

const createApiKeySchema = z.object({
    name: z.string().min(1).max(100),
    expiresAt: z.string().datetime().optional(),
    permissions: z.array(z.string()).default(["read"]),
});

router.post(
    "/",
    authenticateUser,
    createKeyLimiter,
    async (req: Request, res: Response) => {
        try {
            const { name, expiresAt, permissions } = createApiKeySchema.parse(
                req.body
            );

            // Generate API key
            const apiKey = `pk_${crypto.randomBytes(32).toString("hex")}`;
            const hashedKey = crypto
                .createHash("sha256")
                .update(apiKey)
                .digest("hex");

            // Generate Ethereum keypair
            const { address, privateKey } = generateEthereumKeyPair();

            // Encrypt private key
            const encryptedPrivateKey = encryptData(privateKey);

            const newApiKey = await prisma.apiKey.create({
                data: {
                    key: hashedKey,
                    name,
                    userId: req.userId!,
                    expiresAt: expiresAt ? new Date(expiresAt) : null,
                    permissions,
                    // Store Ethereum keypair
                    publicKey: address,
                    encryptedPrivateKey: encryptedPrivateKey.encryptedData,
                    keyPairIV: encryptedPrivateKey.iv,
                    keyPairAuthTag: encryptedPrivateKey.authTag,
                },
            });

            res.status(201).json({
                message: "API key created successfully",
                apiKey,
                id: newApiKey.id,
                name: newApiKey.name,
                expiresAt: newApiKey.expiresAt,
                permissions: newApiKey.permissions,
                publicKey: address, // Include the Ethereum address in the response
            });
        } catch (error) {
            console.error("Error creating API key:", error);
            res.status(400).json({ error: "Invalid request" });
        }
    }
);

router.get(
    "/",
    authenticateUser,
    async (req: Request, res: Response): Promise<void> => {
        const apiKeys = await prisma.apiKey.findMany({
            where: {
                userId: req.userId,
            },
            select: {
                id: true,
                name: true,
                lastUsed: true,
                expiresAt: true,
                createdAt: true,
                isActive: true,
                permissions: true,
                publicKey: true,
            },
        });

        res.json(apiKeys);
    }
);

// Update the delete route to ensure keypair is deleted
router.delete(
    "/:id",
    authenticateUser,
    async (req: Request, res: Response): Promise<void> => {
        try {
            const apiKey = await prisma.apiKey.findFirst({
                where: {
                    id: req.params.id,
                    userId: req.userId,
                },
            });

            if (!apiKey) {
                res.status(404).json({ error: "API key not found" });
                return;
            }

            // The keypair will be automatically deleted due to CASCADE delete
            await prisma.apiKey.delete({
                where: {
                    id: req.params.id,
                },
            });

            res.json({
                message: "API key and associated keypair deleted successfully",
            });
        } catch (error) {
            res.status(500).json({ error: "Failed to delete API key" });
        }
    }
);

export default router;
